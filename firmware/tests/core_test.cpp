#include "../kerumo_v3/src/core.h"
#include "../kerumo_v3/src/protocol.h"
#include "../kerumo_v3/src/diagnostics.h"
#include "../kerumo_v3/src/journal_upgrade.h"
#include "legacy_journal_fixture.h"
#include "program_v3_journal_fixture.h"
#include <cassert>
#include <cstring>
#include <cstdio>
#include <map>
#include <vector>
#include <limits>
using namespace kerumo;
struct TestClock : Clock {
  uint64_t ms=1000; int64_t epoch=1790686800000LL; bool valid=true;
  uint32_t monotonicMs() const override { return ms; }
  uint64_t uptimeMs() const override { return ms; }
  int64_t utcMs() const override { return valid?epoch+ms:0; }
};
struct TestBus : Bus {
  TestClock& clock; unsigned readDelay=0; bool readable=true,apply=true,echo=true,stopWorks=true,followTarget=true;
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
      if (address==0x2001) { registers[0x2102]=value/2; if(followTarget && runningForward(registers[0x2101])) registers[0x2103]=value/2; }
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
  bool armExtended() {
    // Physical SU600A: keypad F5.00=1001 is returned as 0x1001 (decimal 4097).
    bus.registers[0x602]=50; bus.registers[0x500]=0x1001; bus.registers[0x408]=0;
    return controller.arm(SessionMode::ExtendedTest);
  }
};
void protectionRegisterEncoding() {
  Fixture f; assert(f.armExtended()); assert(f.bus.writes.empty());
  auto config=readConfig(f.bus); assert(config.protection==4097);
  // Manual: overload enabled, PID break protection 0/1, loss action 0/2,
  // oscillation suppression 0/1. These are all permitted keypad combinations.
  const uint16_t permitted[]={0x0001,0x0011,0x0201,0x0211,0x1001,0x1011,0x1201,0x1211};
  for (uint32_t raw=0;raw<=0xFFFF;++raw) {
    bool expected=false;
    for (const auto word:permitted) if (raw==word) expected=true;
    config.protection=static_cast<uint16_t>(raw);
    assert(config.extendedTestOk()==expected);
  }
}
void extendedTestSession() {
  Fixture f; assert(f.armExtended()); f.receive(f.command(1)); f.controller.tick(true);
  const size_t writes=f.bus.writes.size();
  // Command TTL and the old one-minute bench timer cannot stop an accepted extended run.
  f.clock.ms+=120000; f.controller.tick(true);
  assert(f.bus.writes.size()==writes && f.controller.isArmed() && f.controller.journal().motionPossible);
  assert(!f.controller.arm()); // Cannot switch a moving session back to the bench timer.
  assert(f.controller.sessionMode()==SessionMode::ExtendedTest);
  f.receive(f.command(2,Type::Frequency,25)); f.controller.tick(true);
  assert(f.events.records.back().outcome==Outcome::Succeeded);
  f.receive(f.command(3,Type::Stop)); f.controller.tick(true);
  assert(f.events.records.back().outcome==Outcome::Succeeded);
  assert(f.controller.isArmed() && !f.controller.journal().motionPossible);
  assert(f.controller.stopReason()==StopReason::Command);
  f.receive(f.command(4)); f.controller.tick(true); assert(f.controller.journal().motionPossible);
  f.clock.ms=std::numeric_limits<uint32_t>::max()-1000; f.controller.tick(true);
  f.clock.ms=2000; f.controller.tick(true); assert(f.controller.isArmed());
  f.controller.disarm(); f.controller.tick(true);
  assert(!f.controller.isArmed() && !f.controller.journal().motionPossible);
  assert(f.controller.stopReason()==StopReason::LocalDisarm);
}
void extendedGuardsAndRecovery() {
  Fixture disabled(false); assert(!disabled.armExtended() && disabled.bus.writes.empty());
  Fixture missing; assert(!missing.controller.arm(SessionMode::ExtendedTest));
  for (auto [address,value]:std::vector<std::pair<uint16_t,uint16_t>>{{0x602,0},{0x602,49},{0x602,101},
      {0x500,0x1101},{0x500,0x1000},{0x500,0x1301},{0x500,0x1021},{0x500,0x2001},{0x408,1}}) {
    Fixture f; assert(f.armExtended()); f.bus.registers[address]=value;
    assert(!f.controller.arm(SessionMode::ExtendedTest)); assert(!f.controller.isArmed()); assert(f.bus.writes.empty());
  }
  Fixture configuredStop; assert(configuredStop.armExtended()); configuredStop.bus.registers[0x500]=0x1201;
  assert(configuredStop.controller.arm(SessionMode::ExtendedTest));
  for (unsigned failure=0;failure<6;++failure) {
    Fixture f; assert(f.armExtended()); f.receive(f.command(1)); f.controller.tick(true);
    if(failure==0) f.controller.tick(false);
    if(failure==1) { f.bus.registers[0x2100]=16; f.controller.sample(); }
    if(failure==2) { f.bus.readable=false; f.controller.sample(); f.bus.readable=true; }
    if(failure==3) { f.bus.registers[0x602]=0; f.clock.ms+=10001; f.controller.tick(true); }
    if(failure==4) { f.bus.registers[0x500]=0x1101; f.receive(f.command(2,Type::Frequency,20)); }
    if(failure==5) { f.storage.fail=true; f.receive(f.command(2,Type::Frequency,20)); f.storage.fail=false; }
    f.clock.ms+=1000; f.controller.tick(true);
    assert(!f.controller.isArmed() && !f.controller.journal().motionPossible);
    const size_t n=f.bus.writes.size(); f.receive(f.command(3)); f.controller.tick(true);
    assert(f.bus.writes.size()==n && f.events.records.back().error==Error::NotArmed);
  }
  Fixture pending; assert(pending.armExtended()); pending.receive(pending.command(1)); pending.controller.tick(true);
  pending.bus.stopWorks=false; pending.receive(pending.command(2,Type::Stop));
  pending.clock.ms+=10001; pending.controller.tick(true); assert(!pending.controller.isArmed());
  pending.bus.stopWorks=true; pending.clock.ms+=1000; pending.controller.tick(true);
  assert(!pending.controller.journal().motionPossible && !pending.controller.isArmed());
  Fixture reset; assert(reset.armExtended()); reset.receive(reset.command(1)); reset.controller.tick(true);
  Controller reboot(reset.bus,reset.storage,reset.clock,reset.events,true); assert(reboot.begin("test-device"));
  assert(!reboot.isArmed() && reboot.sessionMode()==SessionMode::Bench);
  reboot.tick(true); assert(!reboot.journal().motionPossible && !reboot.isArmed());
}
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
  Fixture recovery; assert(recovery.controller.arm()); recovery.receive(recovery.command(1));
  recovery.bus.readable=false;
  Controller disconnectedBoot(recovery.bus,recovery.storage,recovery.clock,recovery.events,true);
  assert(disconnectedBoot.begin("test-device")); disconnectedBoot.tick(true);
  assert(disconnectedBoot.journal().motionPossible);
  recovery.bus.readable=true; recovery.clock.ms+=1000; disconnectedBoot.tick(true);
  assert(!disconnectedBoot.journal().motionPossible);
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
void diagnosticStopLifecycle() {
  Fixture f;
  assert(f.controller.sample().lastStop.reason==StopReason::None);
  assert(f.armExtended()); f.receive(f.command(1)); f.controller.tick(true);
  // 64-bit diagnostic clock must not wrap at the control clock's 49-day boundary.
  f.clock.ms=(1ULL<<32)+2000; f.bus.stopWorks=false;
  f.controller.tick(false);
  const auto first=f.controller.sample();
  assert(first.uptimeMs>(1ULL<<32) && first.lastStop.reason==StopReason::Network);
  assert(!first.lastStop.confirmed && first.lastStop.requestedUtcMs!=0);
  f.clock.ms+=2000; f.controller.tick(false);
  auto retried=f.controller.sample();
  assert(retried.lastStop.uptimeMs==first.lastStop.uptimeMs);
  f.bus.stopWorks=true; f.clock.ms+=1000; f.controller.tick(true);
  assert(f.controller.sample().lastStop.confirmed);
  assert(f.armExtended()); f.receive(f.command(2)); f.controller.tick(true);
  assert(f.controller.sample().lastStop.reason==StopReason::Network); // last event survives a new RUN
  f.receive(f.command(3,Type::Stop));
  auto requested=f.controller.sample();
  assert(requested.lastStop.reason==StopReason::Command && !requested.lastStop.confirmed);
  f.controller.tick(true); assert(f.controller.sample().lastStop.confirmed);
  f.controller.disarm(); // already stopped: no invented physical stop event
  assert(f.controller.sample().lastStop.reason==StopReason::Command);

  Fixture unknown; assert(unknown.armExtended()); unknown.receive(unknown.command(1)); unknown.controller.tick(true);
  unknown.clock.valid=false; unknown.controller.disarm();
  const auto noUtc=unknown.controller.sample();
  assert(noUtc.lastStop.reason==StopReason::LocalDisarm && noUtc.lastStop.requestedUtcMs==0);
  unknown.clock.valid=true;
  assert(unknown.controller.sample().lastStop.requestedUtcMs==0); // never invent the past UTC
  Controller reboot(unknown.bus,unknown.storage,unknown.clock,unknown.events,true);
  assert(reboot.begin("test-device"));
  assert(reboot.sample().lastStop.reason==StopReason::Restart && !reboot.sample().lastStop.confirmed);
  reboot.tick(true); assert(reboot.sample().lastStop.confirmed);
  Controller cleanBoot(unknown.bus,unknown.storage,unknown.clock,unknown.events,true);
  assert(cleanBoot.begin("test-device")); assert(cleanBoot.sample().lastStop.reason==StopReason::None);

  JsonDocument doc;
  writeDiagnostics(doc.to<JsonObject>(),first,"0.2.2","brownout",{"wifi","rssi",-67});
  assert(doc["uptime_ms"].as<uint64_t>()==first.uptimeMs);
  assert(doc["last_stop"]["reason"]=="network_lost" && !doc["last_stop"]["confirmed"].as<bool>());
  assert(doc["connection"]["signal"]["dbm"]==-67);
  int64_t recorded=0; assert(parseUtcMs(doc["last_stop"]["requested_at"],recorded));
  assert(recorded==first.lastStop.requestedUtcMs/1000*1000);
  doc.clear(); writeDiagnostics(doc.to<JsonObject>(),noUtc,"0.2.2","software",{"cellular","rsrp",-105});
  assert(doc["last_stop"]["requested_at"].isNull() && doc["connection"]["signal"]["metric"]=="rsrp");
  doc.clear(); writeDiagnostics(doc.to<JsonObject>(),cleanBoot.sample(),"0.2.2","power_on",{"ethernet",nullptr,0});
  assert(doc["last_stop"].isNull() && doc["connection"]["signal"].isNull());
}

Command programCommand(Fixture& f,uint64_t sequence=1) {
  auto c=f.command(sequence,Type::Program);
  c.program.count=2; c.program.steps[0]={20,10}; c.program.steps[1]={30,20}; return c;
}
void reachHold(Fixture& f) {
  f.clock.ms+=300; f.controller.tick(true); // Підтвердження частоти перед єдиним RUN.
  f.clock.ms+=300; f.controller.tick(true); // Досягнута вихідна частота починає витримку.
  assert(f.controller.sample().program.phase==ProgramPhase::Holding);
}
void programExecution() {
  Fixture f; assert(f.armExtended()); auto c=programCommand(f); f.receive(c); reachHold(f);
  const auto writes=f.bus.writes.size(); f.receive(c); assert(f.bus.writes.size()==writes);
  f.clock.epoch-=7200000; // Корекція UTC не прискорює монотонний відлік.
  f.clock.ms+=9999; f.controller.tick(true); assert(f.controller.sample().program.step==1);
  f.clock.ms+=300; f.controller.tick(true); assert(f.controller.sample().program.phase==ProgramPhase::Setting);
  f.clock.ms+=300; f.controller.tick(true); assert(f.controller.sample().program.step==2);
  assert(f.controller.sample().program.phase==ProgramPhase::Holding);
  f.clock.ms+=20000; f.controller.tick(true); assert(f.controller.sample().program.phase==ProgramPhase::Stopping);
  f.clock.ms+=1000; f.controller.tick(true);
  assert(!f.controller.journal().motionPossible && f.controller.isArmed());
  const auto& record=f.controller.journal().records[0];
  assert(record.outcome==Outcome::Succeeded && record.stepsCompleted==2 && record.programStopConfirmed);
  assert(f.controller.sample().program.phase==ProgramPhase::Completed);
  assert(f.controller.sample().lastStop.reason==StopReason::ProgramCompleted);
  size_t starts=0; for (auto write:f.bus.writes) if(write.first==0x2000 && write.second==0x12) ++starts;
  assert(starts==1);
}
void programCancellationAndRecovery() {
  Fixture immediate; immediate.clock.ms=0; assert(immediate.armExtended());
  immediate.receive(programCommand(immediate)); reachHold(immediate);
  immediate.receive(immediate.command(2,Type::Stop)); immediate.controller.tick(true);
  assert(immediate.clock.ms<1000); // Прямий readback випереджає періодичний повтор STOP.
  assert(immediate.controller.journal().records[0].outcome==Outcome::Failed);
  assert(immediate.controller.journal().records[0].programStopConfirmed);
  assert(immediate.controller.sample().program.phase==ProgramPhase::Interrupted);
  const auto immediateWrites=immediate.bus.writes.size();
  immediate.clock.ms+=120000; immediate.controller.tick(true);
  assert(immediate.bus.writes.size()==immediateWrites);
  for(unsigned failure=0;failure<6;++failure) {
    Fixture f; assert(f.armExtended()); auto c=programCommand(f); f.receive(c); reachHold(f);
    if(failure==0) f.receive(f.command(2,Type::Stop));
    if(failure==1) f.controller.tick(false);
    if(failure==2) f.controller.disarm();
    if(failure==3) { f.bus.readable=false; f.clock.ms+=300; f.controller.tick(true); f.bus.readable=true; }
    if(failure==4) { f.bus.registers[0x2100]=16; f.clock.ms+=300; f.controller.tick(true); }
    if(failure==5) { f.bus.registers[0x602]=0; f.clock.ms+=10001; f.controller.tick(true); }
    f.clock.ms+=1000; f.controller.tick(true);
    assert(!f.controller.journal().motionPossible);
    assert(f.controller.journal().records[0].outcome==Outcome::Failed);
    const auto writes=f.bus.writes.size(); f.clock.ms+=120000; f.receive(c); f.controller.tick(true);
    assert(f.bus.writes.size()==writes); // Жодний наступний етап чи повтор не відновлює RUN.
  }
  Fixture restart; assert(restart.armExtended()); restart.receive(programCommand(restart)); reachHold(restart);
  Controller reboot(restart.bus,restart.storage,restart.clock,restart.events,true);
  assert(reboot.begin("test-device")); reboot.tick(true);
  assert(!reboot.isArmed() && !reboot.journal().motionPossible);
  assert(reboot.journal().records[0].error==Error::Restarted && reboot.journal().records[0].outcome==Outcome::Failed);
  assert(reboot.sample().program.phase==ProgramPhase::Interrupted);
}
void programBoundaries() {
  Fixture bench; assert(bench.controller.arm()); bench.receive(programCommand(bench)); assert(bench.bus.writes.empty());
  Fixture f; assert(f.armExtended()); f.receive(programCommand(f)); reachHold(f);
  f.receive(f.command(2,Type::Frequency,40)); assert(f.events.records.back().error==Error::Busy);
  f.receive(programCommand(f,3)); assert(f.events.records.back().error==Error::Busy);
  f.bus.stopWorks=false; f.receive(f.command(4,Type::Stop));
  f.clock.ms+=60001; f.controller.tick(true);
  assert(f.controller.journal().motionPossible && f.controller.journal().records[0].outcome==Outcome::Unknown);
  f.bus.stopWorks=true; f.clock.ms+=1000; f.controller.tick(true); assert(!f.controller.journal().motionPossible);
  Fixture automatic; assert(automatic.armExtended()); auto timed=programCommand(automatic);
  timed.program.count=1; automatic.receive(timed); reachHold(automatic);
  automatic.bus.stopWorks=false; automatic.clock.ms+=10000; automatic.controller.tick(true);
  automatic.clock.ms+=60001; automatic.controller.tick(true);
  assert(automatic.controller.journal().records[0].outcome==Outcome::Unknown);
  assert(!automatic.controller.isArmed() && automatic.controller.journal().motionPossible);
  const auto blockedWrites=automatic.bus.writes.size();
  automatic.receive(automatic.command(2,Type::Frequency,40));
  assert(automatic.events.records.back().error==Error::NotArmed && automatic.bus.writes.size()==blockedWrites);
  automatic.bus.stopWorks=true; automatic.clock.ms+=1000; automatic.controller.tick(true);
  assert(!automatic.controller.journal().motionPossible && !automatic.controller.isArmed());
  Fixture target; assert(target.armExtended()); auto c=programCommand(target); target.receive(c);
  target.clock.ms+=300; target.controller.tick(true); target.bus.registers[0x2103]=500;
  target.clock.ms+=300; target.controller.tick(true);
  assert(target.controller.sample().program.phase==ProgramPhase::Starting);
  target.clock.ms+=60001; target.controller.tick(true); target.clock.ms+=1000; target.controller.tick(true);
  assert(target.controller.journal().records[0].error==Error::ProgramTimeout);
  Fixture storage; assert(storage.armExtended()); storage.storage.fail=true; storage.receive(programCommand(storage)); assert(storage.bus.writes.empty());
  Fixture rollover; rollover.clock.ms=(1ULL<<32)-1000; assert(rollover.armExtended()); auto longRun=programCommand(rollover);
  longRun.program.count=1; longRun.program.steps[0].seconds=86400; rollover.receive(longRun); reachHold(rollover);
  rollover.clock.ms+=86400000; rollover.controller.tick(true); rollover.clock.ms+=1000; rollover.controller.tick(true);
  assert(rollover.controller.journal().records[0].outcome==Outcome::Succeeded);
}
void programParsingAndMigration() {
  const char* input=R"({"schema_version":2,"control_sequence":42,"command_id":"00000000-0000-4000-8000-000000000042","request_id":"00000000-0000-4000-8000-000000000001","issued_at":"2026-09-29T13:00:00Z","expires_at":"2026-09-29T13:00:30Z","ttl_seconds":30,"command_type":"vfd.program.start","payload":{"version":1,"steps":[{"frequency_hz":40,"duration_seconds":7200},{"frequency_hz":50,"duration_seconds":3600}]}})";
  Command c; assert(parseCommand(input,strlen(input),c)); assert(c.program.count==2 && c.program.steps[1].seconds==3600);
  for(unsigned n=0;n<8;++n) {
    JsonDocument doc; deserializeJson(doc,input);
    if(n==0) doc["payload"]["version"]=true;
    if(n==1) doc["payload"]["steps"][0]["duration_seconds"]=true;
    if(n==2) doc["payload"]["steps"][0]["frequency_hz"]=0;
    if(n==3) doc["payload"]["steps"][0]["frequency_hz"]=20.001;
    if(n==4) doc["payload"]["steps"][0]["duration_seconds"]=86400;
    if(n==5) doc["payload"]["steps"][0]["extra"]=1;
    if(n==6) doc["payload"]["steps"].clear();
    if(n==7) doc["payload"]["steps"][0]["duration_seconds"]="10";
    std::string json;serializeJson(doc,json);assert(!parseCommand(json.c_str(),json.size(),c));
  }
  auto bytes=legacyFixtureBytes();
  static_assert(sizeof(LegacyJournal)==sizeof(bytes), "Legacy NVS ABI changed");
  LegacyJournal actualOld{}; std::memcpy(&actualOld,bytes.data(),bytes.size());
  Journal migrated{}; assert(upgradeJournal(actualOld,migrated));
  assert(migrated.highest==42 && migrated.motionPossible && migrated.next==1);
  assert(std::strcmp(migrated.records[0].command.id,"00000000-0000-4000-8000-000000000042")==0);
  assert(migrated.records[0].command.sequence==42 && migrated.records[0].outcome==Outcome::Pending);
  LegacyJournal old{}; strcpy(old.uid,"test-device"); old.highest=42; old.motionPossible=true;
  old.records[0].command.sequence=42; old.records[0].command.type=Type::Start;
  old.records[0].outcome=Outcome::Pending; old.next=1; old.checksum=legacyChecksum(old);
  Journal next{}; assert(upgradeJournal(old,next)); assert(next.highest==42 && next.motionPossible);
  assert(next.records[0].command.sequence==42 && next.records[0].outcome==Outcome::Pending);
  TestClock clock; TestBus bus(clock); TestStorage storage; TestEvents events;
  storage.exists=true; storage.saved=next; Controller controller(bus,storage,clock,events,true);
  assert(controller.begin("test-device")); controller.tick(true); assert(!controller.journal().motionPossible && controller.journal().highest==42);
  old.highest++; assert(!upgradeJournal(old,next));
}

Command scheduledCommand(Fixture& f) {
  auto c=programCommand(f); c.type=Type::Schedule;
  c.scheduledStartMs=f.clock.utcMs(); c.scheduledStopMs=c.scheduledStartMs+30000;
  return c;
}
void calendarExecution() {
  Fixture f; assert(f.armExtended()); auto c=scheduledCommand(f);
  c.scheduledStartMs-=5000; c.scheduledStopMs-=5000;
  const uint64_t accepted=f.clock.ms;
  f.receive(c); reachHold(f);
  const auto count=f.bus.writes.size(); f.receive(c); assert(f.bus.writes.size()==count);
  f.clock.epoch+=3600000; // Після прийняття STOP прив'язаний до монотонної межі.
  f.clock.ms=accepted+5000; f.controller.tick(true);
  assert(f.controller.sample().program.step==2);
  f.clock.ms+=300; f.controller.tick(true);
  f.clock.ms=accepted+25000; f.controller.tick(true);
  assert(f.controller.sample().program.phase==ProgramPhase::Stopping);
  f.clock.ms+=1000; f.controller.tick(true);
  assert(f.controller.journal().records[0].outcome==Outcome::Succeeded);
  assert(f.controller.journal().records[0].programStopConfirmed);
  assert(!f.controller.journal().motionPossible);

  for(unsigned action=0;action<3;++action) {
    Fixture stop; assert(stop.armExtended()); auto plan=scheduledCommand(stop); stop.receive(plan); reachHold(stop);
    if(action==0) stop.receive(stop.command(2,Type::Stop));
    if(action==1) stop.controller.tick(false);
    if(action==2) {
      Controller reboot(stop.bus,stop.storage,stop.clock,stop.events,true);
      assert(reboot.begin("test-device")); reboot.tick(true);
      assert(!reboot.isArmed() && reboot.journal().records[0].error==Error::Restarted);
      continue;
    }
    stop.clock.ms+=1000; stop.controller.tick(true);
    const auto writes=stop.bus.writes.size(); stop.clock.ms+=60000; stop.controller.tick(true); stop.receive(plan);
    assert(stop.bus.writes.size()==writes && !stop.controller.journal().motionPossible);
  }
  for(int offset: {-1000,31000}) {
    Fixture late; assert(late.armExtended()); auto plan=scheduledCommand(late);
    plan.scheduledStartMs-=offset; plan.scheduledStopMs-=offset; late.receive(plan);
    assert(late.bus.writes.empty() && late.events.records.back().error==Error::Expired);
  }
  Fixture ramp; assert(ramp.armExtended()); auto plan=scheduledCommand(ramp); ramp.receive(plan);
  ramp.clock.ms+=300; ramp.controller.tick(true); ramp.bus.registers[0x2103]=0;
  ramp.clock.ms+=10000; ramp.controller.tick(true); ramp.clock.ms+=1000; ramp.controller.tick(true);
  assert(ramp.controller.journal().records[0].error==Error::ProgramTimeout);
  assert(!ramp.controller.journal().motionPossible);
}
void calendarParsingAndMigration() {
  const auto bytes=programV3FixtureBytes();
  static_assert(sizeof(ProgramJournalV3)==sizeof(bytes),"v0.3 NVS ABI changed");
  ProgramJournalV3 original{}; std::memcpy(&original,bytes.data(),bytes.size());
  Journal upgraded{}; assert(upgradeJournal(original,upgraded));
  assert(upgraded.highest==42 && upgraded.motionPossible && upgraded.records[0].command.program.count==2);
  assert(upgraded.records[0].command.program.steps[1].seconds==120);
  const char* json=R"({"schema_version":2,"control_sequence":42,"command_id":"00000000-0000-4000-8000-000000000042","request_id":"00000000-0000-4000-8000-000000000001","issued_at":"2076-02-29T13:00:00Z","expires_at":"2076-02-29T13:00:30Z","ttl_seconds":30,"command_type":"vfd.schedule.start","payload":{"version":1,"starts_at":"2076-02-29T13:00:00Z","stops_at":"2076-02-29T13:02:00Z","steps":[{"frequency_hz":40,"duration_seconds":60},{"frequency_hz":50,"duration_seconds":60}]}})";
  Command c; assert(parseCommand(json,strlen(json),c) && c.type==Type::Schedule && c.scheduledStartMs>2147483647000LL);
  for(unsigned n=0;n<4;++n) {
    JsonDocument doc; deserializeJson(doc,json);
    if(n==0) doc["payload"]["stops_at"]="2076-02-29T13:03:00Z";
    if(n==1) doc["payload"]["starts_at"]="2100-02-29T13:00:00Z";
    if(n==2) doc["payload"]["starts_at"]="2076-02-29T13:00:00.001Z";
    if(n==3) doc["payload"]["starts_at"]="2076-02-29T13:00:00+03:00";
    std::string raw; serializeJson(doc,raw); assert(!parseCommand(raw.c_str(),raw.size(),c));
  }
  ProgramJournalV3 old{}; strcpy(old.uid,"test-device"); old.highest=42; old.next=1; old.motionPossible=true;
  auto& previous=old.records[0]; previous.command.type=Type::Program; previous.command.sequence=42;
  previous.command.program.count=1; previous.command.program.steps[0]={40,60}; previous.outcome=Outcome::Pending;
  strcpy(previous.command.id,"00000000-0000-4000-8000-000000000042"); old.checksum=legacyChecksum(old);
  Journal next{}; assert(upgradeJournal(old,next)); assert(next.highest==42 && next.records[0].command.program.steps[0].seconds==60);
  TestClock clock; TestBus bus(clock); TestStorage storage; TestEvents events;
  storage.saved=next; storage.exists=true; Controller reboot(bus,storage,clock,events,true);
  assert(reboot.begin("test-device")); reboot.tick(true); assert(!reboot.isArmed() && !reboot.journal().motionPossible);
  assert(reboot.journal().records[0].error==Error::Restarted);
  ++old.highest; assert(!upgradeJournal(old,next));
}

int main() {
  calendarExecution(); calendarParsingAndMigration();
  programExecution(); programCancellationAndRecovery(); programBoundaries(); programParsingAndMigration();
  readOnlyAndConfiguration(); timingAndOrdering(); echoIsNotPhysicalResult(); duplicateAndRestart();
  crashWindowAndStopRetry(); storageAndBoundedHistory(); profilesAndFrames(); protocol();
  protectionRegisterEncoding(); extendedTestSession(); extendedGuardsAndRecovery();
  diagnosticStopLifecycle();
  puts("PASS: calendar (fixed deadlines, UTC/2038, STOP/reboot, v0.3 ABI migration); programs (hold timing, STOP, reboot, errors, strict plans, NVS upgrade), read-only, profile/scaling, TTL, sequence, duplicate/reboot, crash window, stop retry, network loss, storage, CRC, strict v2 parsing, all 65536 F5.00 words, extended session and loss-of-permission recovery");
}
