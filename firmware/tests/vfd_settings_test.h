#pragma once
void vfdSettingsTests() {
  {
    const char* wire=R"({"schema_version":2,"control_sequence":42,"command_id":"00000000-0000-4000-8000-000000000042","request_id":"00000000-0000-4000-8000-000000000001","issued_at":"2026-09-29T13:00:00Z","expires_at":"2026-09-29T13:00:30Z","ttl_seconds":30,"command_type":"vfd.parameter.set","payload":{"code":"F0.10","expected_raw":75,"value_raw":100}})";
    Command parsed; assert(parseCommand(wire,strlen(wire),parsed));
    assert(parsed.type==Type::Parameter && parsed.setting.expected==75 && parsed.setting.value==100);
    for (int failure=0;failure<7;++failure) {
      JsonDocument doc; deserializeJson(doc,wire);
      if (failure==0) doc["payload"]["code"]="F5.00";
      if (failure==1) doc["payload"]["value_raw"]=true;
      if (failure==2) doc["payload"]["value_raw"]=0;
      if (failure==3) doc["payload"]["value_raw"]=10000;
      if (failure==4) doc["payload"]["expected_raw"]="75";
      if (failure==5) doc["payload"]["address"]=10;
      if (failure==6) doc["payload"]["value_raw"]=1.5;
      std::string text; serializeJson(doc,text); assert(!parseCommand(text.c_str(),text.size(),parsed));
    }
  }
  {
    Fixture f;
    remoteProfile(f);
    f.bus.registers[0x000A] = 75;
    f.bus.registers[0x000B] = 75;
    f.controller.tick(true, true);
    auto local = f.command(1, Type::Source);
    local.setting.expectedRun=2; local.setting.expectedFrequency=6;
    f.bus.settingEcho=false; // Source changes are confirmed by independent reads after echoed STOP/zero.
    f.receive(local);
    assert(f.events.records.back().outcome == Outcome::Succeeded);
    assert(f.bus.registers[2] == 0 && f.bus.registers[3] == 0);
    assert(!f.controller.isArmed() && !f.controller.journal().motionPossible);
    assert(f.bus.writes.size() == 4);
    assert(f.bus.writes[0].first==0x2000 && f.bus.writes[0].second==1);
    assert(f.bus.writes[1].first==0x2001 && f.bus.writes[1].second==0);
    assert(f.bus.writes[2].first==3 && f.bus.writes[2].second==0 && f.bus.writes[3].first==2);
    f.clock.ms += 3001;
    f.controller.tick(true, true);
    assert(!f.controller.isArmed() && f.controller.sample().settingsReady);
    const auto writes = f.bus.writes.size();
    f.receive(local); assert(f.bus.writes.size() == writes); // Durable duplicate never writes.
    auto remote = f.command(2, Type::Source);
    remote.setting.remote=true; remote.setting.expectedRun=0; remote.setting.expectedFrequency=0;
    f.bus.echo=true; f.bus.localSetpoint=true; // Knob stays turned up until F0.03 switches away from it.
    f.receive(remote);
    assert(f.events.records.back().outcome == Outcome::Succeeded);
    assert(f.bus.registers[2] == 2 && f.bus.registers[3] == 6 && f.bus.registers[0x2102] == 0);
    assert(!f.controller.isArmed() && !f.controller.journal().motionPossible);
    for (const auto& write : f.bus.writes) assert(write.first != 0x2000 || write.second == 1); // Never RUN.
    assert(f.bus.writes[4].first==0x2000 && f.bus.writes[5].first==0x2001);
    assert(f.bus.writes[6].first==3 && f.bus.writes[7].first==2);
    auto oldStart = f.command(3);
    f.clock.ms += 3001; f.controller.tick(true, true);
    assert(f.controller.isArmed());
    f.receive(oldStart); assert(f.events.records.back().error == Error::NotArmed);
  }
  for (unsigned failure=0; failure<7; ++failure) {
    Fixture f; remoteProfile(f);
    f.bus.registers[0x000A]=75; f.bus.registers[0x000B]=75;
    f.controller.tick(true, true);
    auto c=f.command(1, Type::Parameter);
    std::strcpy(c.setting.code, "F0.10"); c.setting.expected=75; c.setting.value=100;
    if (failure==0) f.bus.registers[0x2101]=9;
    if (failure==1) f.bus.registers[0x2103]=1;
    if (failure==2) f.controller.disarm();
    if (failure==3) c.setting.expected=76;
    if (failure==4) std::strcpy(c.setting.code, "F5.00");
    if (failure==5) f.storage.fail=true;
    if (failure==6) f.clock.ms+=30000;
    const auto writes=f.bus.writes.size(); f.receive(c);
    assert(f.bus.writes.size()==writes);
  }
  {
    Fixture f; remoteProfile(f);
    f.bus.registers[0x000A]=75; f.bus.registers[0x000B]=75;
    f.controller.tick(true,true);
    auto c=f.command(1,Type::Parameter);
    std::strcpy(c.setting.code,"F0.11"); c.setting.expected=75; c.setting.value=100;
    f.bus.echo=false; f.receive(c); // Parameter readback can confirm a missing FC06 echo.
    assert(f.events.records.back().outcome==Outcome::Succeeded);
    assert(f.bus.writes.size()==1 && f.bus.writes[0].first==0x000B);
    assert(f.events.records.back().settingResult.before==75 && f.events.records.back().settingResult.actual==100);
    const auto writes=f.bus.writes.size(); f.receive(c); assert(f.bus.writes.size()==writes);
    f.clock.ms+=3001; f.controller.tick(true,true);
    auto ignored=f.command(2,Type::Parameter); std::strcpy(ignored.setting.code,"F0.10");
    ignored.setting.expected=75; ignored.setting.value=100; f.bus.apply=false;
    f.receive(ignored);
    assert(f.events.records.back().outcome==Outcome::Failed && f.events.records.back().error==Error::Unconfirmed);
    assert(f.events.records.back().settingResult.actual==75);
  }
  {
    Fixture f; remoteProfile(f); f.bus.registers[2]=1;
    f.controller.tick(true,true);
    auto c=f.command(1,Type::Source); c.setting.remote=true; c.setting.expectedRun=1; c.setting.expectedFrequency=6;
    f.receive(c); assert(f.bus.writes.empty()); // Installation terminal priority cannot be bypassed.
  }
  for (bool lostLink : {false,true}) {
    Fixture f; remoteProfile(f); f.controller.tick(true,true);
    auto c=f.command(1,Type::Source); c.setting.expectedRun=2; c.setting.expectedFrequency=6;
    if (lostLink) f.bus.dropLinkAddress=3;
    else f.bus.ignoredAddress=2;
    f.receive(c);
    assert(f.events.records.back().outcome==Outcome::Failed);
    assert(f.events.records.back().error==Error::Unconfirmed);
    assert(f.bus.registers[3]==0 && f.bus.registers[2]==2);
    assert(!f.controller.isArmed() && !f.controller.journal().motionPossible);
    const size_t writes=f.bus.writes.size(); f.receive(c); assert(f.bus.writes.size()==writes);
    assert(f.events.records.back().settingResult.sourceKnown);
    assert(f.events.records.back().settingResult.runSource==2 && f.events.records.back().settingResult.frequencySource==0);
    assert(f.bus.writes.size()==(lostLink?3:4));
  }
  {
    Fixture f; remoteProfile(f); f.bus.registers[2]=0; f.bus.registers[3]=1;
    f.controller.tick(true,true); f.bus.echo=false;
    auto c=f.command(1,Type::Source); c.setting.remote=true; c.setting.expectedRun=0; c.setting.expectedFrequency=1;
    f.receive(c);
    assert(f.bus.writes.size()==1 && f.bus.writes[0].first==0x2000);
    assert(f.bus.registers[2]==0 && f.bus.registers[3]==1);
    assert(f.events.records.back().outcome==Outcome::Failed); // Lost preparation echo cannot enable remote RUN.
  }
  {
    Fixture f; remoteProfile(f); f.controller.tick(true,true); f.bus.crashAddress=3;
    auto c=f.command(1,Type::Source); c.setting.expectedRun=2; c.setting.expectedFrequency=6;
    try { f.receive(c); assert(false); } catch (int) {}
    assert(f.storage.saved.records[0].settingResult.attempted);
    assert(f.bus.registers[3]==0 && f.bus.registers[2]==2);
    f.bus.crashAddress=0xFFFF;
    Controller reboot(f.driver,f.storage,f.clock,f.events,true); assert(reboot.begin("test-device"));
    const size_t writes=f.bus.writes.size(); reboot.tick(true,true);
    assert(f.bus.writes.size()==writes && reboot.journal().records[0].outcome==Outcome::Unknown);
    assert(reboot.journal().records[0].settingResult.attempted && !reboot.journal().records[0].settingResult.sourceKnown);
  }
  {
    Fixture f; remoteProfile(f); f.bus.registers[2]=0; f.bus.registers[3]=1; f.bus.registers[0x500]=0;
    f.controller.tick(true,true);
    auto c=f.command(1,Type::Source); c.setting.remote=true; c.setting.expectedRun=0; c.setting.expectedFrequency=1;
    f.receive(c); assert(f.bus.writes.empty()); // Returning to remote retains protection checks.
    assert(f.controller.sample().bindingCompatible); // Local source preserves the installed-driver identity.
    Fixture disabled(false); remoteProfile(disabled); disabled.controller.tick(true,true);
    auto noWrite=disabled.command(1,Type::Source); noWrite.setting.expectedRun=2; noWrite.setting.expectedFrequency=6;
    disabled.receive(noWrite); assert(disabled.bus.writes.empty() && !disabled.controller.sample().settingsReady);
  }
  {
    CalendarJournalV5 old{};
    std::strcpy(old.uid,"test-device"); old.highest=99; old.motionPossible=true;
    auto& record=old.records[0]; record.command.type=Type::Schedule; record.command.sequence=99;
    record.command.scheduledStartMs=1791540000000LL; record.command.scheduledStopMs=1791540060000LL;
    record.command.program.count=1; record.command.program.steps[0]={20,60};
    record.outcome=Outcome::Pending;
    old.checksum=legacyChecksum(old);
    Journal upgraded{}; assert(upgradeJournal(old,upgraded));
    assert(upgraded.highest==99 && upgraded.motionPossible);
    assert(upgraded.records[0].command.scheduledStopMs==record.command.scheduledStopMs);
    assert(upgraded.records[0].command.setting.code[0]==0);
    ScopedCalendarV4 scoped{}; scoped.journal=old; scoped.checksum=legacyChecksum(scoped);
    ScopedJournal next{}; assert(upgradeScope(scoped,next)); next.checksum=scopeChecksum(next);
    assert(validScope(next) && next.journal.highest==99);
    scoped.checksum^=1; assert(!upgradeScope(scoped,next));
  }
  {
    Fixture f; remoteProfile(f); f.controller.tick(true,true);
    auto c=f.command(1,Type::Source); c.setting.expectedRun=2; c.setting.expectedFrequency=6;
    auto& r=f.storage.saved.records[0]; r.command=c; r.outcome=Outcome::Pending;
    f.storage.saved.highest=1; f.storage.saved.checksum=checksum(f.storage.saved);
    Controller reboot(f.driver,f.storage,f.clock,f.events,true); assert(reboot.begin("test-device"));
    reboot.tick(true,true); assert(f.bus.writes.empty());
    assert(reboot.journal().records[0].outcome==Outcome::Unknown);
  }
  for (uint16_t localSource : {0, 1}) {
    Fixture f; remoteProfile(f); f.bus.registers[2]=0; f.bus.registers[3]=localSource;
    f.bus.localSetpoint=true;
    f.controller.tick(true,true);
    auto remote=f.command(1,Type::Source); remote.setting.remote=true;
    remote.setting.expectedRun=0; remote.setting.expectedFrequency=localSource;
    f.receive(remote);
    assert(f.events.records.back().outcome==Outcome::Succeeded);
    assert(f.bus.registers[2]==2 && f.bus.registers[3]==6 && f.bus.registers[0x2102]==0);
    assert(!f.controller.isArmed() && !f.controller.journal().motionPossible);
    for (const auto& write : f.bus.writes) assert(write.first!=0x2000 || write.second==1);
  }
  {
    Fixture f; remoteProfile(f); f.controller.tick(true,true); f.bus.echo=false;
    auto local=f.command(1,Type::Source); local.setting.expectedRun=2; local.setting.expectedFrequency=6;
    f.receive(local);
    assert(f.events.records.back().outcome==Outcome::Failed);
    assert(f.bus.writes.size()==1 && f.bus.writes[0].first==0x2000);
    assert(f.bus.registers[2]==2 && f.bus.registers[3]==6); // Never expose the knob with an uncleared RUN word.
  }
  {
    Fixture f; remoteProfile(f); f.bus.registers[2]=0; f.bus.registers[3]=0;
    f.bus.registers[0x000A]=75; f.bus.registers[0x000B]=75;
    f.controller.tick(true,true);
    assert(f.controller.sample().settingsReady && f.controller.sample().bindingCompatible);
    for (bool ok : f.controller.sample().vfd.ok) assert(ok); // Telemetry remains available with the knob.
    auto parameter=f.command(1,Type::Parameter); std::strcpy(parameter.setting.code,"F0.10");
    parameter.setting.expected=75; parameter.setting.value=100;
    f.receive(parameter);
    assert(f.events.records.back().outcome==Outcome::Succeeded);
    assert(f.bus.registers[2]==0 && f.bus.registers[3]==0);
    assert(f.bus.writes.size()==1 && f.bus.writes[0].first==0x000A);
  }
  puts("PASS: knob/keypad sources, CAS, readback, lost echo, stopped/permission/expiry guards, no RUN, duplicate and NVS upgrades");
}
