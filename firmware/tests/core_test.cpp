#include "../kerumo_v3/src/core.h"
#include "../kerumo_v3/src/protocol.h"
#include <cassert>
#include <cstring>
#include <cstdio>
#include <map>
#include <vector>
#include <limits>
using namespace kerumo;
struct TestClock : Clock {
  uint32_t ms=1000; int64_t epoch=1790686800000LL; bool valid=true;
  uint32_t monotonicMs() const override { return ms; }
  int64_t utcMs() const override { return valid?epoch+ms:0; }
};
struct TestBus : Bus {
  TestClock& clock; unsigned readDelay=0; bool readable=true,apply=true,echo=true,stopWorks=true;
  std::map<uint16_t,uint16_t> registers{{2,2},{3,6},{4,500},{5,500},{6,0},{0x600,1},{0x601,0},
    {0x602,0},{0x603,5},{0x604,100},{0x605,0},{0x2100,0},{0x2101,2},{0x2102,1000},{0x2103,0},{0x2104,0},{0x2106,0}};
  std::vector<std::pair<uint16_t,uint16_t>> writes;
  explicit TestBus(TestClock& c):clock(c){}
  bool read(uint16_t address,uint16_t& value) override {
    clock.ms+=readDelay;
    if (!readable || !registers.count(address)) return false;
    value=registers[address]; return true;
  }
  bool write(uint16_t address,uint16_t value) override {
    writes.emplace_back(address,value);
    if (apply) {
      if (address==0x2000 && value==0x12) { registers[0x2101]=9; registers[0x2103]=registers[0x2102]; }
      if (address==0x2000 && value==1 && stopWorks) { registers[0x2101]=2; registers[0x2103]=0; }
      if (address==0x2001) registers[0x2102]=value/2;
    }
    return echo;
  }
};
struct TestStorage : Storage {
  Journal saved{}; bool exists=false,fail=false; int saves=0;
  int load(Journal& value) override { if(exists) value=saved; return exists?1:0; }
  bool save(const Journal& value) override { ++saves; if(fail)return false; saved=value; exists=true; return true; }
};
struct TestEvents : Events { std::vector<Record> records; void emit(const Record& r) override { records.push_back(r); } };
struct Fixture {
  TestClock clock; TestBus bus{clock}; TestStorage storage; TestEvents events;
  Controller controller;
  explicit Fixture(bool controls=true):controller(bus,storage,clock,events,controls) { assert(controller.begin("test-device")); }
  Command command(uint64_t sequence,Type type=Type::Start,double hz=0) {
    Command c{}; snprintf(c.id,sizeof(c.id),"00000000-0000-4000-8000-%012llu",static_cast<unsigned long long>(sequence));
    c.sequence=sequence; c.issuedMs=clock.utcMs(); c.expiresMs=c.issuedMs+30000; c.ttl=30; c.type=type; c.hz=hz; return c;
  }
  void receive(const Command& c) { controller.receive(c,"11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"); }
};
void readOnlyAndConfiguration() {
  Fixture f(false); assert(f.bus.writes.empty()); assert(!f.controller.arm());
  f.receive(f.command(1)); f.receive(f.command(2,Type::Stop)); f.clock.ms+=90000; f.controller.tick(false);
  assert(f.bus.writes.empty()); assert(f.events.records.back().error==Error::ReadOnly);
  for (auto [address,value]:std::vector<std::pair<uint16_t,uint16_t>>{{4,600},{5,400},{6,10},{0x604,200},{0x605,1},{2,0},{3,0}}) {
    Fixture bad; bad.bus.registers[address]=value; assert(!bad.controller.arm()); bad.receive(bad.command(1)); assert(bad.bus.writes.empty());
  }
  Fixture unknown; unknown.bus.registers[0x605]=1; unknown.receive(unknown.command(1,Type::Stop)); assert(unknown.bus.writes.empty());
}
void timingAndOrdering() {
  Fixture f; assert(f.controller.arm()); auto c=f.command(1); f.clock.ms+=30000; f.receive(c); assert(f.bus.writes.empty());
  f.clock.valid=false; f.receive(f.command(2)); assert(f.bus.writes.empty());
  Fixture delayed; assert(delayed.controller.arm()); c=delayed.command(1); c.expiresMs=c.issuedMs+5000; c.ttl=5; delayed.bus.readDelay=500;
  delayed.receive(c); assert(delayed.bus.writes.empty());
  Fixture order; order.receive(order.command(2,Type::Stop)); order.controller.tick(true); size_t n=order.bus.writes.size();
  assert(order.controller.arm()); order.receive(order.command(1)); assert(order.bus.writes.size()==n);
}
void echoIsNotPhysicalResult() {
  Fixture f; assert(f.controller.arm()); f.bus.apply=false; f.receive(f.command(1));
  f.controller.tick(true); assert(f.events.records.back().outcome==Outcome::Pending);
  f.clock.ms+=10001; f.controller.tick(true); assert(f.events.records.back().outcome==Outcome::Unknown);
  Fixture lost; assert(lost.controller.arm()); lost.bus.echo=false; lost.receive(lost.command(1)); lost.controller.tick(true);
  assert(lost.events.records.back().outcome==Outcome::Succeeded);
  Fixture wrong; assert(wrong.controller.arm()); wrong.bus.apply=false; wrong.receive(wrong.command(1,Type::Frequency,25)); wrong.controller.tick(true);
  assert(wrong.events.records.back().outcome==Outcome::Pending);
}
void duplicateAndRestart() {
  Fixture f; assert(f.controller.arm()); auto c=f.command(1); f.receive(c); f.controller.tick(true);
  size_t n=f.bus.writes.size(); auto response=f.events.records.back(); f.clock.ms+=40000; f.receive(c);
  assert(f.bus.writes.size()==n); assert(f.events.records.back().acceptedMs==response.acceptedMs);
  auto changed=c; changed.hz=5; f.receive(changed); assert(f.bus.writes.size()==n);
  Controller restarted(f.bus,f.storage,f.clock,f.events,true); assert(restarted.begin("test-device"));
  restarted.receive(c,"s","a","r"); assert(f.bus.writes.size()==n); assert(!restarted.isArmed());
  restarted.tick(true); assert(f.bus.writes.back()==std::make_pair(uint16_t(0x2000),uint16_t(1)));
  assert(!restarted.journal().motionPossible);
  Controller wrongIdentity(f.bus,f.storage,f.clock,f.events,true); assert(!wrongIdentity.begin("another-device"));
  f.storage.saved.highest++; Controller corrupt(f.bus,f.storage,f.clock,f.events,true); assert(!corrupt.begin("test-device"));
}
void crashWindowAndStopRetry() {
  Fixture f; assert(f.controller.arm()); f.receive(f.command(1)); // crash before readback/result
  Controller restarted(f.bus,f.storage,f.clock,f.events,true); assert(restarted.begin("test-device"));
  assert(restarted.journal().records[0].outcome==Outcome::Unknown);
  restarted.tick(true); assert(!restarted.journal().motionPossible);
  Fixture timer; assert(timer.controller.arm()); timer.receive(timer.command(1)); timer.controller.tick(true);
  timer.bus.stopWorks=false; timer.clock.ms+=60000; timer.controller.tick(true); size_t tries=timer.bus.writes.size();
  assert(timer.controller.journal().motionPossible);
  timer.clock.ms+=1000; timer.controller.tick(true); assert(timer.bus.writes.size()>tries);
  timer.bus.stopWorks=true; timer.clock.ms+=1000; timer.controller.tick(true); assert(!timer.controller.journal().motionPossible);
  Fixture offline; assert(offline.controller.arm()); offline.receive(offline.command(1)); offline.controller.tick(false);
  assert(!offline.controller.journal().motionPossible); assert(!offline.controller.isArmed());
}
void storageAndBoundedHistory() {
  Fixture f; assert(f.controller.arm()); f.storage.fail=true; f.receive(f.command(1)); assert(f.bus.writes.empty());
  Fixture history;
  for(unsigned i=1;i<24;++i) { history.receive(history.command(i,Type::Stop)); history.controller.tick(true); }
  size_t writes=history.bus.writes.size(); assert(history.controller.arm()); history.receive(history.command(1));
  assert(history.bus.writes.size()==writes);
}
void profilesAndFrames() {
  Fixture f; const auto config=readConfig(f.bus); uint16_t raw=0;
  assert(frequencyWord(10,config,raw)&&raw==2000); assert(frequencyWord(25.1,config,raw)&&raw==5020);
  assert(!frequencyWord(std::numeric_limits<double>::quiet_NaN(),config,raw)); assert(!frequencyWord(51,config,raw));
  const uint8_t response[]={1,3,2,0,0,0xB8,0x44}; assert(readResponse(response,7,1,raw)&&raw==0);
  assert(!readResponse(response,7,2,raw)); assert(!readResponse(response,6,1,raw));
  const uint8_t exception[]={1,0x83,2,0xC0,0xF1}; assert(!readResponse(exception,5,1,raw));
  uint8_t write[]={1,6,0x20,0,0,1,0,0}; uint16_t crc=modbusCrc(write,6); write[6]=crc; write[7]=crc>>8;
  assert(writeResponse(write,8,write)); uint8_t bad[8]; memcpy(bad,write,8); bad[4]=1; assert(!writeResponse(bad,8,write));
  assert(!stopped(3,0)); assert(!stopped(2,1)); assert(stopped(2,0)); assert(runningForward(9)); assert(!runningForward(17));
}
void protocol() {
  int64_t ms=0; assert(parseUtcMs("2026-09-29T13:00:00.123456+00:00",ms));
  assert(ms==1790686800123LL); assert(!parseUtcMs("2026-02-29T13:00:00Z",ms)); assert(!parseUtcMs("2026-09-29T13:00:00",ms));
  const char* text=R"({"schema_version":2,"control_sequence":42,"command_id":"00000000-0000-4000-8000-000000000042","request_id":"00000000-0000-4000-8000-000000000001","issued_at":"2026-09-29T13:00:00.123456Z","expires_at":"2026-09-29T13:00:30.123456Z","ttl_seconds":30,"command_type":"vfd.frequency.set","payload":{"frequency_hz":25.1}})";
  Command c; assert(parseCommand(text,strlen(text),c)); assert(c.sequence==42&&std::fabs(c.hz-25.1)<0.00001);
  JsonDocument doc; deserializeJson(doc,text);
  for(int test=0;test<7;++test) {
    deserializeJson(doc,text);
    if(test==0)doc["schema_version"]=1;
    if(test==1)doc["control_sequence"]=true;
    if(test==2)doc["ttl_seconds"]=300;
    if(test==3)doc["payload"]["frequency_hz"]="25";
    if(test==4)doc["payload"]["frequency_hz"]=true;
    if(test==5)doc["extra"]=1;
    if(test==6)doc["command_id"]="invalid";
    std::string serialized; serializeJson(doc,serialized); assert(!parseCommand(serialized.c_str(),serialized.size(),c));
  }
}
int main() {
  readOnlyAndConfiguration(); timingAndOrdering(); echoIsNotPhysicalResult(); duplicateAndRestart();
  crashWindowAndStopRetry(); storageAndBoundedHistory(); profilesAndFrames(); protocol();
  puts("PASS: read-only, profile/scaling, TTL, sequence, duplicate/reboot, crash window, stop retry, network loss, storage, CRC and strict v2 parsing");
}
