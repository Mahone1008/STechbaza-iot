#pragma once
// Exercises the real driver, durable journal and command path, not a mock policy.
void remoteProfile(Fixture &f) {
  f.bus.registers[0x602] = 50;
  f.bus.registers[0x500] = 0x1001;
  f.bus.registers[0x408] = 0;
}
void remotePermissionAndLocalStop() {
  Fixture f;
  remoteProfile(f);
  f.controller.tick(true);
  assert(!f.controller.isArmed() && f.bus.writes.empty());
  f.controller.tick(false, true);
  assert(!f.controller.isArmed() && f.bus.writes.empty());
  f.controller.tick(true, true);
  assert(f.controller.isArmed() && f.bus.writes.empty());
  assert(f.controller.sessionMode() == SessionMode::ExtendedTest);
  f.clock.ms += 1;
  f.receive(f.command(1));
  f.controller.tick(true, true);
  assert(f.controller.journal().motionPossible);
  assert(f.controller.sample().commandSequence == 1);
  const size_t runningWrites = f.bus.writes.size();
  f.clock.ms += 120000;
  f.controller.tick(true, true);
  assert(f.bus.writes.size() == runningWrites && f.controller.isArmed());
  f.receive(f.command(2, Type::Stop));
  f.controller.tick(true, true);
  assert(f.controller.isArmed() && !f.controller.journal().motionPossible);
  f.receive(f.command(3));
  f.controller.tick(true, true);
  f.controller.disarm();
  f.clock.ms += 1000;
  f.controller.tick(true, true);
  assert(!f.controller.isArmed() && !f.controller.journal().motionPossible);
  const size_t stoppedWrites = f.bus.writes.size();
  f.clock.ms += 60000;
  f.controller.tick(true, true);
  assert(!f.controller.isArmed() && f.bus.writes.size() == stoppedWrites);
  f.bus.registers[0x2100] = 16;
  assert(!f.controller.arm(SessionMode::ExtendedTest));
  f.bus.registers[0x2100] = 0;
  f.clock.ms += 3001;
  f.controller.tick(true, true);
  assert(!f.controller.isArmed());
  assert(f.controller.arm(SessionMode::ExtendedTest));
  assert(f.controller.isArmed() && f.bus.writes.size() == stoppedWrites);
}
void remoteGuardsAndReconnect() {
  Fixture disabled(false);
  remoteProfile(disabled);
  disabled.controller.tick(true, true);
  assert(!disabled.controller.isArmed() && disabled.bus.writes.empty());
  for (unsigned failure = 0; failure < 6; ++failure) {
    Fixture f;
    remoteProfile(f);
    if (failure == 0) f.clock.valid = false;
    if (failure == 1) f.bus.readable = false;
    if (failure == 2) f.bus.registers[0x602] = 0;
    if (failure == 3) f.bus.registers[0x2100] = 16;
    if (failure == 4) f.bus.registers[0x2101] = 9;
    if (failure == 5) f.bus.registers[0x2103] = 1000;
    f.controller.tick(true, true);
    assert(!f.controller.isArmed() && f.bus.writes.empty());
  }
  Fixture f;
  remoteProfile(f);
  f.controller.tick(true, true);
  f.clock.ms += 1;
  f.receive(f.command(1));
  f.controller.tick(true, true);
  auto queuedStart = f.command(2);
  f.controller.tick(false, true);
  assert(!f.controller.isArmed() && !f.controller.journal().motionPossible);
  f.bus.registers[0x2100] = 16;
  f.clock.ms += 3001;
  f.controller.tick(true, true);
  assert(!f.controller.isArmed());
  f.bus.registers[0x2100] = 0;
  f.clock.ms += 3001;
  f.controller.tick(true, true);
  assert(f.controller.isArmed() && !f.controller.journal().motionPossible);
  const size_t writes = f.bus.writes.size();
  f.receive(queuedStart);
  assert(f.events.records.back().error == Error::NotArmed && f.bus.writes.size() == writes);
  f.receive(f.command(3));
  f.controller.tick(true, true);
  assert(f.controller.journal().motionPossible);
  f.storage.fail = true;
  const size_t beforeFailure = f.bus.writes.size();
  f.receive(f.command(4, Type::Frequency, 20));
  assert(!f.controller.isArmed() && f.bus.writes.size() == beforeFailure);
}
void remoteRestartRecovery() {
  Fixture f;
  remoteProfile(f);
  f.controller.tick(true, true);
  f.clock.ms += 1;
  auto acceptedStart = f.command(1);
  f.receive(acceptedStart);
  f.controller.tick(true, true);
  auto oldStart = f.command(2);
  Controller reboot(f.driver, f.storage, f.clock, f.events, true);
  assert(reboot.begin("test-device"));
  assert(!reboot.isArmed());
  f.bus.stopWorks = false;
  f.clock.ms += 3001;
  reboot.tick(true, true);
  assert(!reboot.isArmed() && reboot.journal().motionPossible);
  assert(f.bus.writes.back() == std::make_pair(uint16_t(0x2000), uint16_t(1)));
  f.bus.stopWorks = true;
  f.clock.ms += 3001;
  const size_t beforeRecovery = f.bus.writes.size();
  reboot.tick(true, true);
  assert(reboot.isArmed() && !reboot.journal().motionPossible);
  assert(f.bus.writes.size() == beforeRecovery + 1);
  const size_t recoveredWrites = f.bus.writes.size();
  reboot.receive(acceptedStart, "", "", "");
  reboot.receive(oldStart, "", "", "");
  assert(f.events.records.back().error == Error::NotArmed);
  assert(f.bus.writes.size() == recoveredWrites);
  reboot.receive(f.command(3), "", "", "");
  reboot.tick(true, true);
  assert(reboot.journal().motionPossible && reboot.journal().highest == 3);
}
void remoteRunningInterlocks() {
  for (unsigned failure = 0; failure < 3; ++failure) {
    Fixture f;
    remoteProfile(f);
    f.controller.tick(true, true);
    f.receive(f.command(1));
    f.controller.tick(true, true);
    if (failure == 0) f.bus.registers[0x2100] = 16;
    if (failure == 1) f.bus.readable = false;
    if (failure == 2) f.bus.registers[0x408] = 1;
    f.controller.sample();
    f.clock.ms += 10001;
    f.controller.tick(true, true);
    f.clock.ms += 1001;
    f.controller.tick(true, true);
    assert(!f.controller.isArmed());
    f.bus.registers[0x2100] = 0;
    f.bus.registers[0x408] = 0;
    f.bus.readable = true;
    f.clock.ms += 3001;
    f.controller.tick(true, true);
    assert(f.controller.isArmed() && !f.controller.journal().motionPossible);
    unsigned starts = 0;
    for (const auto &write : f.bus.writes)
      if (write.first == 0x2000 && write.second == 0x12) ++starts;
    assert(starts == 1); // Recovery can issue STOP and permission, never another START.
  }
}
void remoteProgramRestart() {
  Fixture f;
  remoteProfile(f);
  f.controller.tick(true, true);
  auto command = programCommand(f);
  f.receive(command);
  reachHold(f);
  Controller reboot(f.driver, f.storage, f.clock, f.events, true);
  assert(reboot.begin("test-device"));
  f.clock.ms += 3001;
  reboot.tick(true, true);
  assert(reboot.isArmed() && !reboot.journal().motionPossible);
  assert(reboot.sample().program.phase == ProgramPhase::Interrupted);
  assert(f.events.records.back().error == Error::Restarted);
  const size_t stoppedWrites = f.bus.writes.size();
  f.clock.ms += 60000;
  reboot.tick(true, true);
  reboot.receive(command, "", "", "");
  assert(f.bus.writes.size() == stoppedWrites);
}
