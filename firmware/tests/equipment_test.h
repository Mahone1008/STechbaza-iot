#pragma once
#include "../kerumo_v3/src/scoped_journal.h"
#include <fstream>
#include <sstream>

struct SemanticDriver : VfdDriver {
  double target=75, output=0; bool running=false; unsigned starts=0,stops=0;
  const char* profileId() const override { return "test.semantic-drive"; }
  unsigned profileVersion() const override { return 9; }
  void refreshConfig() override {}
  bool profileOk() const override { return true; }
  bool controlOk() const override { return true; }
  bool extendedTestOk() const override { return true; }
  bool recoveryAllowed() override { return true; }
  bool frequencyAllowed(double hz) const override { return std::isfinite(hz) && hz>=70 && hz<=90; }
  bool readFault(uint16_t& value) override { value=0; return true; }
  bool readState(DriveState& value) override { value={65535,!running,running,running}; return true; }
  bool readSetHz(double& value) override { value=target; return true; }
  bool readOutputHz(double& value) override { value=output; return true; }
  bool readCurrentA(double& value) override { value=2.3; return true; }
  bool readVoltageV(double& value) override { value=230; return true; }
  bool startForward() override { ++starts; running=true; output=target; return true; }
  bool stop() override { ++stops; running=false; output=0; return true; }
  bool setFrequency(double hz) override { if(!frequencyAllowed(hz)) return false; target=hz; return true; }
};
void driverIndependence() {
  TestClock clock; TestStorage storage; TestEvents events; SemanticDriver driver;
  Controller controller(driver,storage,clock,events,true);
  assert(controller.begin("test-device") && controller.arm());
  Fixture requests;
  auto command=requests.command(1,Type::Frequency,80);
  controller.receive(command,"11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333");
  controller.tick(true);
  assert(driver.target==80 && events.records.back().outcome==Outcome::Succeeded);
  command=requests.command(2,Type::Start);
  controller.receive(command,"11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333");
  controller.tick(true);
  assert(driver.starts==1 && events.records.back().outcome==Outcome::Succeeded);
  auto sample=controller.sample();
  assert(sample.vfd.outputHz==80 && sample.vfd.currentA==2.3 && sample.vfd.state.running);
  controller.tick(false); clock.ms+=1100; controller.tick(false);
  assert(driver.stops>0 && !driver.running);
  Fixture limits; limits.driver.setInstallationLimits(20,45); limits.driver.refreshConfig();
  assert(!limits.driver.frequencyAllowed(19.99) && limits.driver.frequencyAllowed(20));
  assert(limits.driver.frequencyAllowed(45) && !limits.driver.frequencyAllowed(45.01));
  assert(!limits.driver.setFrequency(50) && limits.bus.writes.empty());
}
void equipmentBindingAndJournal() {
  // The same canonical JSON fixture is validated by the Python contract tests.
  std::ifstream file("backend/tests/fixtures/equipment_manifest.json");
  std::stringstream buffer; buffer<<file.rdbuf(); const std::string manifest=buffer.str();
  EquipmentBinding binding{};
  assert(parseEquipment(manifest.data(),manifest.size(),"test-device",binding));
  assert(binding.revision==3 && binding.generation==2 && binding.minHz==20 && binding.maxHz==45);
  assert(!parseEquipment(manifest.data(),manifest.size(),"another-device",binding));
  JsonDocument changed; assert(!deserializeJson(changed,manifest)); changed["profile_id"]="suswe.su100.modbus";
  std::string text; serializeJson(changed,text);
  assert(!parseEquipment(text.data(),text.size(),"test-device",binding));
  std::memset(binding.hash,'a',64); binding.hash[64]=0;
  JsonDocument doc;
  doc["schema_version"]=3; doc["control_sequence"]=17;
  doc["command_id"]="33333333-3333-4333-8333-333333333333"; doc["request_id"]="44444444-4444-4444-8444-444444444444";
  doc["issued_at"]="2026-10-02T00:00:00Z"; doc["expires_at"]="2026-10-02T00:00:30Z";
  doc["ttl_seconds"]=30; doc["command_type"]="vfd.start"; doc["payload"].to<JsonObject>();
  auto target=doc["equipment_target"].to<JsonObject>(); target["binding_id"]=binding.bindingId;
  target["revision"]=binding.revision; target["configuration_hash"]=binding.hash;
  auto encode=[&] { std::string result; serializeJson(doc,result); return result; };
  Command command{}; text=encode();
  assert(parseCommand(text.data(),text.size(),command,&binding));
  assert(!parseCommand(text.data(),text.size(),command));
  target["revision"]=2; text=encode(); assert(!parseCommand(text.data(),text.size(),command,&binding));
  target["revision"]=3; target["binding_id"]="55555555-5555-4555-8555-555555555555";
  text=encode(); assert(!parseCommand(text.data(),text.size(),command,&binding));
  target["binding_id"]=binding.bindingId; target["configuration_hash"]=std::string(64,'b');
  text=encode(); assert(!parseCommand(text.data(),text.size(),command,&binding));
  doc.remove("equipment_target"); doc["schema_version"]=2; text=encode();
  assert(parseCommand(text.data(),text.size(),command)); assert(!parseCommand(text.data(),text.size(),command,&binding));

  Fixture prior; assert(prior.controller.arm()); prior.receive(prior.command(42));
  auto scoped=wrapJournal(prior.controller.journal(),binding.hash); assert(validScope(scoped));
  auto next=journalForNewBinding(scoped.journal);
  assert(next.highest==42 && !next.motionPossible && validJournal(next));
  for (const auto& row:next.records) assert(row.outcome==Outcome::Empty);
  scoped.configurationHash[0]='b'; assert(!validScope(scoped));
  struct MismatchStorage : TestStorage {
    int load(Journal& value) override { value=saved; return -1; }
  } locked;
  locked.saved=prior.controller.journal();
  TestClock clock; TestBus bus(clock); Su600Driver driver(bus); TestEvents events;
  Controller rejected(driver,locked,clock,events,true);
  assert(!rejected.begin("test-device") && !rejected.arm());
  clock.ms+=70000; rejected.tick(false); rejected.sample();
  assert(bus.writes.empty()); // An old run latch cannot stop or start replacement equipment.
}
