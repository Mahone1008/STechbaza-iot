#include "core.h"
#include <cmath>
#include <cstring>
#include <cctype>
#include <limits>

namespace kerumo {
const char* errorCode(Error error) {
  static const char* codes[] = {"none", "read_only", "not_armed", "clock_unsynchronized", "expired",
    "stale_sequence", "configuration_mismatch", "vfd_fault", "frequency_out_of_range", "busy",
    "storage_failed", "physical_result_unconfirmed", "restart_during_execution"};
  return codes[static_cast<unsigned>(error)];
}
uint32_t checksum(const Journal& value) {
  const auto* bytes = reinterpret_cast<const uint8_t*>(&value);
  uint32_t crc = 0xFFFFFFFFU;
  for (size_t i = 0; i < sizeof(value); ++i) {
    const uint8_t byte = i >= offsetof(Journal, checksum) && i < offsetof(Journal, checksum) + 4 ? 0 : bytes[i];
    crc ^= byte;
    for (unsigned bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xEDB88320U & (0U - (crc & 1U)));
  }
  return ~crc;
}
bool validUuid(const char* s) {
  if (!s || std::strlen(s) != 36) return false;
  for (unsigned i = 0; i < 36; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (s[i] != '-') return false; }
    else if (!std::isxdigit(static_cast<unsigned char>(s[i]))) return false;
  }
  return true;
}
bool sameCommand(const Command& a, const Command& b) {
  return std::strcmp(a.id, b.id) == 0 && std::strcmp(a.requestId, b.requestId) == 0 && a.sequence == b.sequence && a.issuedMs == b.issuedMs &&
    a.expiresMs == b.expiresMs && a.ttl == b.ttl && a.type == b.type && a.hz == b.hz;
}
// Strict UTC RFC3339, accepting Z / +00:00 and up to six fractional digits.
bool parseUtcMs(const char* s, int64_t& result) {
  if (!s || std::strlen(s) < 20 || std::strlen(s) > 32) return false;
  if (s[4]!='-' || s[7]!='-' || s[10]!='T' || s[13]!=':' || s[16]!=':') return false;
  auto number = [s](int offset, int count) {
    int n = 0;
    for (int i = 0; i < count; ++i) { if (s[offset+i]<'0' || s[offset+i]>'9') return -1; n=n*10+s[offset+i]-'0'; }
    return n;
  };
  int y=number(0,4), m=number(5,2), d=number(8,2), h=number(11,2), min=number(14,2), sec=number(17,2);
  if (y<2020 || y>2100 || m<1 || m>12 || d<1 || h<0 || h>23 || min<0 || min>59 || sec<0 || sec>59) return false;
  const int days[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  const bool leap = y%4==0 && (y%100!=0 || y%400==0);
  if (d>days[m-1]+(m==2 && leap ? 1 : 0)) return false;
  size_t pos=19; int fraction=0, digits=0;
  if (s[pos]=='.') {
    ++pos;
    while (s[pos]>='0' && s[pos]<='9') { if (digits<3) fraction=fraction*10+s[pos]-'0'; ++digits; ++pos; }
    if (digits<1 || digits>6) return false;
    for (int i=digits; i<3; ++i) fraction*=10;
  }
  if (std::strcmp(s+pos,"Z")!=0 && std::strcmp(s+pos,"+00:00")!=0) return false;
  int64_t totalDays=0;
  for (int year=1970; year<y; ++year) totalDays+=365+(year%4==0 && (year%100!=0 || year%400==0));
  for (int month=1; month<m; ++month) totalDays+=days[month-1]+(month==2 && leap ? 1 : 0);
  result=(((totalDays+d-1)*24+h)*60+min)*60000+sec*1000+fraction;
  return true;
}
uint16_t modbusCrc(const uint8_t* bytes, size_t size) {
  uint16_t crc=0xFFFF;
  for (size_t i=0; i<size; ++i) { crc^=bytes[i]; for (unsigned b=0;b<8;++b) crc=(crc>>1)^((crc&1)?0xA001:0); }
  return crc;
}
bool readResponse(const uint8_t* bytes, size_t size, uint8_t slave, uint16_t& value) {
  if (size!=7 || bytes[0]!=slave || bytes[1]!=3 || bytes[2]!=2 || modbusCrc(bytes,size)!=0) return false;
  value=static_cast<uint16_t>((bytes[3]<<8)|bytes[4]); return true;
}
bool writeResponse(const uint8_t* bytes, size_t size, const uint8_t request[8]) {
  return size==8 && std::memcmp(bytes,request,8)==0 && modbusCrc(bytes,size)==0;
}
bool Su600Config::profileOk() const { return readOk && protocol==0 && address==1 && serial==0 && responseDelay<=200; }
bool Su600Config::controlOk() const {
  return profileOk() && runSource==2 && frequencySource==6 && maxRaw==500 && upperRaw==500 && lowerRaw==0 && scaleRaw==100;
}
Su600Config readConfig(Bus& bus) {
  Su600Config result{};
  const uint16_t addresses[] = {0x0002,0x0003,0x0004,0x0005,0x0006,0x0600,0x0601,0x0602,0x0603,0x0604,0x0605};
  uint16_t* values[] = {&result.runSource,&result.frequencySource,&result.maxRaw,&result.upperRaw,&result.lowerRaw,
    &result.address,&result.serial,&result.timeoutRaw,&result.responseDelay,&result.scaleRaw,&result.protocol};
  result.readOk=true;
  for (size_t i=0;i<11;++i) if (!bus.read(addresses[i],*values[i])) { result.readOk=false; break; }
  return result;
}
bool frequencyWord(double hz, const Su600Config& config, uint16_t& result) {
  if (!config.controlOk() || !std::isfinite(hz) || hz<0 || hz>50) return false;
  result=static_cast<uint16_t>(std::lround(hz/(config.maxRaw/10.0)*10000.0)); return true;
}
bool stopped(uint16_t state, uint16_t output) { return (state&3)==2 && output==0; }
bool runningForward(uint16_t state) { return (state&3)==1 && (state&8) && !(state&16); }

Controller::Controller(Bus& bus, Storage& storage, Clock& clock, Events& events, bool controls)
    : bus_(bus),storage_(storage),clock_(clock),events_(events),controls_(controls) {}
bool Controller::save() {
  journal_.checksum=checksum(journal_);
  storageOk_=storage_.save(journal_);
  if (!storageOk_) { armed_=false; if (journal_.motionPossible) stopping_=true; }
  return storageOk_;
}
bool Controller::begin(const char* uid) {
  if (!uid || std::strlen(uid)>96) return false;
  const int loaded=storage_.load(journal_);
  if (loaded<0) return false;
  if (loaded==0) { journal_=Journal{}; std::strncpy(journal_.uid,uid,96); if (!save()) return false; }
  else if (journal_.magic!=0x4B563301 || journal_.checksum!=checksum(journal_) || journal_.next>=LedgerSize ||
      std::strncmp(journal_.uid,uid,sizeof(journal_.uid))!=0 || journal_.highest>MaxSequence) return false;
  storageOk_=true;
  for (auto& record:journal_.records) if (record.outcome==Outcome::Pending) {
    record.outcome=Outcome::Unknown; record.error=Error::Restarted;
  }
  if (!save()) return false;
  config_=readConfig(bus_); lastConfigRead_=clock_.monotonicMs();
  // No blanket boot write: a persisted run intent is stopped only in the verified profile.
  stopping_=controls_ && journal_.motionPossible;
  return true;
}
bool Controller::arm() {
  armed_=false;
  if (!controls_ || !storageOk_ || journal_.motionPossible || pending_>=0 || !clock_.utcMs()) return false;
  config_=readConfig(bus_); lastConfigRead_=clock_.monotonicMs();
  uint16_t state{},output{},fault{};
  armed_=config_.controlOk() && bus_.read(0x2101,state) && bus_.read(0x2103,output) &&
    bus_.read(0x2100,fault) && fault==0 && stopped(state,output);
  return armed_;
}
void Controller::requestStop() { stopping_=true; armed_=false; }
void Controller::disarm() { armed_=false; if (journal_.motionPossible) requestStop(); }
void Controller::finish(Record& record, Outcome outcome, Error error, double actual) {
  record.outcome=outcome; record.error=error; record.actualHz=actual; record.completedMs=clock_.utcMs();
  if (save()) events_.emit(record);
  pending_=-1;
}
void Controller::receive(const Command& c,const char* session,const char* ackId,const char* resultId) {
  if (!storageOk_) return;
  for (const auto& record:journal_.records) if (record.outcome!=Outcome::Empty && std::strcmp(c.id,record.command.id)==0) {
    if (sameCommand(c,record.command)) events_.emit(record);
    return; // conflicting ID never changes the saved response or performs I/O
  }
  Record incoming{}; incoming.command=c;
  std::strncpy(incoming.session,session,36); std::strncpy(incoming.ackId,ackId,36); std::strncpy(incoming.resultId,resultId,36);
  const int64_t now=clock_.utcMs(); incoming.acceptedMs=now;
  Error rejection=Error::None;
  if (!now) rejection=Error::Clock;
  else if (c.issuedMs>now+2000 || c.expiresMs<=now) rejection=Error::Expired;
  else if (c.sequence<=journal_.highest || c.sequence>MaxSequence) rejection=Error::Stale;
  if (rejection!=Error::None) {
    incoming.outcome=Outcome::Failed; incoming.error=rejection; incoming.completedMs=now; events_.emit(incoming); return;
  }
  // A newer Stop must displace pending verification, never wait behind it.
  if (pending_>=0 && c.type==Type::Stop) {
    auto& previous=journal_.records[pending_];
    finish(previous,Outcome::Unknown,Error::Unconfirmed);
    if (!storageOk_) return;
  }
  if (pending_>=0) {
    incoming.outcome=Outcome::Failed; incoming.error=Error::Busy; incoming.completedMs=now;
  } else if (!controls_) {
    incoming.outcome=Outcome::Failed; incoming.error=Error::ReadOnly; incoming.completedMs=now;
  } else if (c.type!=Type::Stop && !armed_) {
    incoming.outcome=Outcome::Failed; incoming.error=Error::NotArmed; incoming.completedMs=now;
  } else incoming.outcome=Outcome::Pending;
  // Never overwrite the one active record if the bounded history wraps.
  size_t slot=journal_.next;
  if (static_cast<int>(slot)==pending_) slot=(slot+1)%LedgerSize;
  journal_.next=(slot+1)%LedgerSize; journal_.highest=c.sequence; journal_.records[slot]=incoming;
  if (!save()) return;
  auto& record=journal_.records[slot]; events_.emit(record);
  if (record.outcome!=Outcome::Pending) return;
  config_=readConfig(bus_); lastConfigRead_=clock_.monotonicMs();
  if (!(c.type==Type::Stop?config_.profileOk():config_.controlOk())) { finish(record,Outcome::Failed,Error::Config); disarm(); return; }
  // Configuration reads take time; expiry is checked again immediately before actuation.
  if (!clock_.utcMs() || clock_.utcMs()>=c.expiresMs) { finish(record,Outcome::Failed,Error::Expired); return; }
  uint16_t fault{},value{};
  if (c.type!=Type::Stop && (!bus_.read(0x2100,fault) || fault!=0)) { finish(record,Outcome::Failed,Error::Fault); return; }
  if (c.type==Type::Frequency && !frequencyWord(c.hz,config_,value)) { finish(record,Outcome::Failed,Error::Frequency); return; }
  if (c.type==Type::Start) {
    uint16_t state{},setpoint{};
    if (journal_.motionPossible || !bus_.read(0x2101,state) || !bus_.read(0x2102,setpoint) || (state&3)!=2 || setpoint==0 || setpoint>5000) {
      finish(record,Outcome::Failed,Error::Frequency); return;
    }
    if (!clock_.utcMs() || clock_.utcMs()>=c.expiresMs) { finish(record,Outcome::Failed,Error::Expired); return; }
    journal_.motionPossible=true; runSince_=clock_.monotonicMs();
  }
  if (c.type==Type::Stop) { journal_.motionPossible=true; requestStop(); }
  // Persist possible physical execution BEFORE the write, including a lost echo/crash window.
  if (!save()) return;
  if (!clock_.utcMs() || clock_.utcMs()>=c.expiresMs) {
    finish(record,Outcome::Failed,Error::Expired);
    if (journal_.motionPossible) requestStop();
    return;
  }
  pending_=static_cast<int>(slot); pendingSince_=clock_.monotonicMs();
  bus_.write(c.type==Type::Frequency?0x2001:0x2000,c.type==Type::Frequency?value:c.type==Type::Start?0x0012:0x0001);
  // FC06 echo is not a physical success. tick() verifies the actual register state.
}
void Controller::tick(bool networkConnected) {
  const uint32_t now=clock_.monotonicMs();
  if (!networkConnected) { armed_=false; if (journal_.motionPossible) requestStop(); }
  if (journal_.motionPossible && static_cast<uint32_t>(now-runSince_)>=AutoStopMs) requestStop();
  if (stopping_ && controls_ && static_cast<uint32_t>(now-lastStopAttempt_)>=1000) {
    lastStopAttempt_=now;
    // UART may have been unavailable during boot with a persisted RUN intent.
    if (!config_.profileOk()) { config_=readConfig(bus_); lastConfigRead_=clock_.monotonicMs(); }
    // Recheck protocol before recovery writes. This is NOT automatic hardware identification.
    uint16_t mode{};
    if (config_.profileOk() && bus_.read(0x0605,mode) && mode==0) {
      bus_.write(0x2000,0x0001);
      uint16_t state{},output{};
      if (bus_.read(0x2101,state) && bus_.read(0x2103,output) && stopped(state,output)) {
        journal_.motionPossible=false; stopping_=false; save();
      }
    }
  }
  if (pending_>=0 && storageOk_) {
    auto& record=journal_.records[pending_]; const Type type=record.command.type;
    uint16_t state{},output{},fault{}; bool verified=false; double actual=0;
    if (type==Type::Frequency) { verified=bus_.read(0x2102,output) && std::fabs(output/100.0-record.command.hz)<=0.11; actual=output/100.0; }
    else if (bus_.read(0x2101,state) && bus_.read(0x2103,output) && bus_.read(0x2100,fault)) {
      verified=type==Type::Stop?stopped(state,output):runningForward(state)&&fault==0&&!stopping_;
      actual=output/100.0;
    }
    if (verified) {
      if (type==Type::Stop) { journal_.motionPossible=false; stopping_=false; }
      finish(record,Outcome::Succeeded,Error::None,actual);
    } else if (static_cast<uint32_t>(now-pendingSince_)>=10000) {
      finish(record,Outcome::Unknown,Error::Unconfirmed); requestStop();
    }
  }
  if (!journal_.motionPossible && pending_<0 && static_cast<uint32_t>(now-lastConfigRead_)>=10000) {
    config_=readConfig(bus_); lastConfigRead_=clock_.monotonicMs();
    if (!config_.controlOk()) armed_=false;
  }
}
Sample Controller::sample() {
  Sample sample{};
  const uint16_t addresses[]={0x2100,0x2101,0x2102,0x2103,0x2104,0x2106};
  // If the configured map is not confirmed, do not label arbitrary registers as SU600 telemetry.
  if (config_.profileOk()) for (size_t i=0;i<6;++i) sample.ok[i]=bus_.read(addresses[i],sample.raw[i]);
  if (journal_.motionPossible && (!sample.ok[0] || !sample.ok[1] || !sample.ok[3] || sample.raw[0]!=0)) requestStop();
  sample.sampledMs=clock_.monotonicMs(); sample.sampledUtcMs=clock_.utcMs();
  sample.configOk=config_.controlOk(); sample.armed=armed_; sample.storageOk=storageOk_;
  return sample;
}
void Controller::replay() const {
  if (storageOk_) for (const auto& record:journal_.records) if (record.outcome!=Outcome::Empty) events_.emit(record);
}
} // namespace kerumo
