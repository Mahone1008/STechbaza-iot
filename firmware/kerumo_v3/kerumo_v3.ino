#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoMqttClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_sntp.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <atomic>
#include <ctime>
#include "src/core.h"
#include "src/protocol.h"
#include "src/diagnostics.h"
#include "src/journal_upgrade.h"
#if __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif
#ifndef KERUMO_ENABLE_EXTENDED_TEST
#define KERUMO_ENABLE_EXTENDED_TEST false
#endif

using namespace kerumo;
namespace {
constexpr char FirmwareVersion[]="0.4.0";
static_assert(sizeof(time_t)>=8,"Calendar execution requires 64-bit time_t");
std::atomic<int64_t> syncEpochMs{0}, syncMonoMs{0};
std::atomic<bool> networkReady{false};
std::atomic<uint32_t> networkCheckedMs{0};
std::atomic<uint8_t> localAction{0}; // 1 bench arm, 2 disarm, 3 replay, 4 extended test arm
QueueHandle_t commands, stopCommands, responses, samples;
char sessionId[37]{};
String baseTopic;
WiFiClientSecure transport;
MqttClient mqtt(transport);
HardwareSerial vfdSerial(1);

void uuid(char* target) {
  uint8_t bytes[16]; esp_fill_random(bytes,sizeof(bytes)); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  snprintf(target,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);
}
void synchronized(struct timeval* tv) {
  syncMonoMs.store(esp_timer_get_time()/1000);
  syncEpochMs.store(static_cast<int64_t>(tv->tv_sec)*1000+tv->tv_usec/1000);
}
class DeviceClock : public Clock {
 public:
  uint32_t monotonicMs() const override { return millis(); }
  uint64_t uptimeMs() const override { return static_cast<uint64_t>(esp_timer_get_time())/1000; }
  int64_t utcMs() const override {
    const int64_t epoch=syncEpochMs.load(), age=esp_timer_get_time()/1000-syncMonoMs.load();
    return epoch>1704067200000LL && age>=0 && age<3600000?epoch+age:0;
  }
} deviceClock;
const char* resetReasonCode() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power_on";
    case ESP_RST_EXT: return "external";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "interrupt_watchdog";
    case ESP_RST_TASK_WDT: return "task_watchdog";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_DEEPSLEEP: return "deep_sleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "unknown";
  }
}
void timestamp(JsonVariant target,int64_t ms) {
  if (!ms) { target.set(nullptr); return; }
  const time_t seconds=ms/1000; struct tm utc{}; gmtime_r(&seconds,&utc);
  char text[32]; strftime(text,sizeof(text),"%Y-%m-%dT%H:%M:%SZ",&utc); target.set(text);
}
class NvsStorage : public Storage {
  Preferences prefs;
 public:
  bool opened=false;
  int load(Journal& value) override {
    opened=prefs.begin("kerumo-v3",false);
    if (!opened) return -1;
    if (!prefs.isKey("journal")) return 0;
    if (prefs.getBytesLength("journal")==sizeof(ProgramJournalV3)) {
      ProgramJournalV3 legacy{};
      if (prefs.getBytes("journal",&legacy,sizeof(legacy))!=sizeof(legacy) || !upgradeJournal(legacy,value)) return -1;
      return 1;
    }
    if (prefs.getBytesLength("journal")==sizeof(LegacyJournal)) {
      LegacyJournal legacy{};
      if (prefs.getBytes("journal",&legacy,sizeof(legacy))!=sizeof(legacy) || !upgradeJournal(legacy,value)) return -1;
      return 1; // begin() перевіряє UID і атомарно зберігає новий blob до керування VFD.
    }
    if (prefs.getBytesLength("journal")!=sizeof(value)) return -1;
    return prefs.getBytes("journal",&value,sizeof(value))==sizeof(value)?1:-1;
  }
  bool save(const Journal& value) override {
    return opened && prefs.putBytes("journal",&value,sizeof(value))==sizeof(value);
  }
} storage;
class Modbus : public Bus {
  uint32_t quietUntil=0;
  bool exchange(uint16_t address,uint16_t value,bool write,uint16_t& result) {
    // Only this task owns UART. Allow delayed frames to drain after a timeout.
    while (static_cast<int32_t>(millis()-quietUntil)<0) { while(vfdSerial.available()) vfdSerial.read(); delay(1); }
    delay(5); while(vfdSerial.available()) vfdSerial.read();
    uint8_t request[8]={1,static_cast<uint8_t>(write?6:3),static_cast<uint8_t>(address>>8),static_cast<uint8_t>(address),
      static_cast<uint8_t>(write?value>>8:0),static_cast<uint8_t>(write?value:1),0,0};
    uint16_t crc=modbusCrc(request,6); request[6]=crc&255; request[7]=crc>>8;
    vfdSerial.write(request,8); vfdSerial.flush();
    uint8_t response[16]{}; size_t count=0; const uint32_t start=millis(); uint32_t last=start;
    while(static_cast<uint32_t>(millis()-start)<250) {
      while(vfdSerial.available()) { int byte=vfdSerial.read(); if(count<sizeof(response)) response[count++]=byte; last=millis(); }
      if (count>=5 && static_cast<uint32_t>(millis()-last)>=5) break;
      delay(1);
    }
    bool ok=write?writeResponse(response,count,request):readResponse(response,count,1,result);
    if (!ok) quietUntil=millis()+250;
    return ok;
  }
 public:
  bool read(uint16_t address,uint16_t& value) override { return exchange(address,0,false,value); }
  bool write(uint16_t address,uint16_t value) override {
    if (!KERUMO_ENABLE_CONTROL) return false; // a second, transport-level read-only guard
    uint16_t unused{}; return exchange(address,value,true,unused);
  }
} bus;
class ResponseEvents : public Events {
 public:
  void emit(const Record& record) override {
    // Network can stall without blocking the VFD task. Full queue is recovered by periodic replay.
    xQueueSend(responses,&record,0);
  }
} events;
Controller controller(bus,storage,deviceClock,events,KERUMO_ENABLE_CONTROL);

void deviceTask(void*) {
  vfdSerial.begin(9600,SERIAL_8N1,18,17);
  const bool ready=controller.begin(KERUMO_DEVICE_UID);
  Serial.printf("V3: storage=%s mode=%s UID=%s\n",ready?"OK":"LOCKED",KERUMO_ENABLE_CONTROL?"CONTROL / DISARMED":"READ ONLY",KERUMO_DEVICE_UID);
  uint32_t lastSample=0,lastReplay=0;
  StopReason lastReason=StopReason::None;
  for (;;) {
    uint8_t action=localAction.exchange(0);
    if (action==1) Serial.println(controller.arm()?"ARMED: SU600 bench, automatic STOP after 60 seconds":"ARM DENIED: inspect configuration, clock and stopped state");
    if (action==4) Serial.println(!KERUMO_ENABLE_EXTENDED_TEST?"ARM TEST DENIED: extended test is disabled in config.local.h":
      controller.arm(SessionMode::ExtendedTest)?"ARMED: SU600 EXTENDED TEST, no duration cap; normal STOP keeps permission":
      "ARM TEST DENIED: verify STOP, clock, profile, F6.02=5.0..10.0s, F5.00 stop-on-loss + overload enabled, F4.08=0");
    if (action==2) { controller.disarm(); Serial.println("DISARMED; pending local STOP is retried until verified"); }
    controller.tick(networkReady.load() && static_cast<uint32_t>(millis()-networkCheckedMs.load())<8000);
    if (controller.stopReason()!=lastReason) {
      lastReason=controller.stopReason();
      Serial.printf("CONTROL: last_stop=%s armed=%d\n",stopReasonCode(lastReason),controller.isArmed());
    }
    Command command{};
    if (xQueueReceive(stopCommands,&command,0)==pdTRUE || xQueueReceive(commands,&command,0)==pdTRUE) {
      char ack[37],result[37]; uuid(ack); uuid(result);
      controller.receive(command,sessionId,ack,result);
    }
    const uint32_t now=millis();
    if (static_cast<uint32_t>(now-lastSample)>=3000) {
      Sample sample=controller.sample(); xQueueOverwrite(samples,&sample); lastSample=millis();
      const auto& c=controller.config();
      Serial.printf("SU600: read=%d profile=%d config=%d F0.02=%u F0.03=%u F0.04=%u F0.05=%u F0.06=%u F6.00=%u F6.01=%u F6.02=%u F6.03=%u F6.04=%u F6.05=%u armed=%d\n",
        c.readOk,c.profileOk(),c.controlOk(),c.runSource,c.frequencySource,c.maxRaw,c.upperRaw,c.lowerRaw,c.address,c.serial,c.timeoutRaw,c.responseDelay,c.scaleRaw,c.protocol,controller.isArmed());
      Serial.printf("TEST: session=%s guards_read=%d ready=%d F5.00=%04X (raw=%u) F4.08=%u last_stop=%s\n",
        controller.sessionMode()==SessionMode::ExtendedTest?"EXTENDED":"BENCH",c.protectionReadOk,c.extendedTestOk(),
        static_cast<unsigned>(c.protection),static_cast<unsigned>(c.protection),c.autoReset,stopReasonCode(controller.stopReason()));
      Serial.printf("READ: fault=%s:%u state=%s:%u set=%s:%.2f out=%s:%.2f I=%s:%.1f U=%s:%.1f\n",
        sample.ok[0]?"OK":"MISSING",sample.raw[0],sample.ok[1]?"OK":"MISSING",sample.raw[1],
        sample.ok[2]?"OK":"MISSING",sample.raw[2]/100.0,sample.ok[3]?"OK":"MISSING",sample.raw[3]/100.0,
        sample.ok[4]?"OK":"MISSING",sample.raw[4]/10.0,sample.ok[5]?"OK":"MISSING",sample.raw[5]/10.0);
    }
    if (action==3 || static_cast<uint32_t>(now-lastReplay)>=10000) { controller.replay(); lastReplay=now; }
    delay(10);
  }
}
void received(int size) {
  const bool valid=!mqtt.messageRetain() && mqtt.messageTopic()==baseTopic+"/commands" && size>0 && size<=1536;
  if (!valid) { Serial.println("COMMAND DROPPED: retained, wrong topic or oversized"); networkReady.store(false); mqtt.stop(); return; }
  char payload[1537]; int count=0;
  const uint32_t started=millis();
  while(count<size && static_cast<uint32_t>(millis()-started)<2000) {
    const int byte=mqtt.read(); if(byte<0) break; payload[count++]=byte;
  }
  if (count!=size) { Serial.println("COMMAND DROPPED: incomplete"); networkReady.store(false); mqtt.stop(); return; }
  Command command{};
  if (!parseCommand(payload,count,command)) { Serial.println("COMMAND DROPPED: invalid v2 envelope"); return; }
  BaseType_t queued;
  if (command.type==Type::Stop) {
    Command waiting{};
    // Keep the newest Stop even when ordinary commands fill their own queue.
    queued=xQueuePeek(stopCommands,&waiting,0)==pdTRUE && waiting.sequence>=command.sequence?
      pdTRUE:xQueueOverwrite(stopCommands,&command);
  } else queued=xQueueSend(commands,&command,0);
  if (queued!=pdTRUE) Serial.println("COMMAND QUEUE FULL: no execution, server may retry");
}
bool publish(const String& suffix,JsonDocument& doc) {
  if (!mqtt.connected()) return false;
  String payload; serializeJson(doc,payload);
  if (!mqtt.beginMessage(baseTopic+suffix,static_cast<unsigned long>(payload.length()),false,1)) return false;
  mqtt.print(payload); return mqtt.endMessage()==1;
}
void envelope(JsonDocument& doc,uint64_t sequence,int64_t at) {
  char message[37]; uuid(message); doc["schema_version"]=1; doc["message_id"]=message;
  doc["sequence"]=sequence; timestamp(doc["sent_at"],at);
}
bool sendRecord(const Record& r) {
  JsonDocument ack;
  ack["schema_version"]=1; ack["message_id"]=r.ackId; ack["command_id"]=r.command.id;
  ack["session_id"]=r.session; timestamp(ack["sent_at"],r.acceptedMs);
  if (!publish("/commands/ack",ack)) return false;
  if (r.outcome==Outcome::Pending || r.outcome==Outcome::Unknown) return true;
  JsonDocument result;
  result["schema_version"]=1; result["message_id"]=r.resultId; result["command_id"]=r.command.id;
  result["session_id"]=r.session; timestamp(result["sent_at"],r.completedMs);
  result["status"]=r.outcome==Outcome::Succeeded?"succeeded":"failed";
  auto data=result["result"].to<JsonObject>();
  if (programType(r.command.type)) {
    data["steps_completed"]=r.stepsCompleted;
    data["step_count"]=r.command.program.count;
    data["stop_confirmed"]=r.programStopConfirmed;
  }
  if (r.outcome==Outcome::Succeeded) { data["frequency_hz"]=r.actualHz; result["error_code"]=nullptr; result["error_message"]=nullptr; }
  else { result["error_code"]=errorCode(r.error); result["error_message"]=errorCode(r.error); }
  return publish("/commands/result",result);
}
void telemetry(const Sample& sample,uint64_t sequence) {
  JsonDocument doc; envelope(doc,sequence,sample.sampledUtcMs); doc["session_id"]=sessionId;
  auto values=doc["values"].to<JsonObject>(); auto state=doc["state"].to<JsonObject>();
  // Never re-label an old sample as current after a network stall.
  const bool fresh=static_cast<uint32_t>(millis()-sample.sampledMs)<5000;
  const char* keys[]={"vfd.set_frequency_hz","vfd.frequency_hz","vfd.current_a","vfd.voltage_v"};
  for (size_t i=0;i<4;++i) if(fresh && sample.ok[i+2]) values[keys[i]]=sample.raw[i+2]/(i<2?100.0:10.0);
  if (fresh && sample.ok[0]) state["vfd_fault_code"]=sample.raw[0];
  if (fresh && sample.ok[1] && (sample.raw[1]&3)==1) state["pump_running"]=true;
  if (fresh && sample.ok[1] && (sample.raw[1]&3)==2) state["pump_running"]=false;
  state["vfd_link"]=fresh && sample.ok[0] && sample.ok[1] && sample.ok[3];
  state["vfd_configuration_valid"]=fresh && sample.configOk;
  state["control_armed"]=fresh && sample.armed && sample.storageOk;
  if (fresh) {
    const int32_t rssi=WiFi.RSSI();
    const bool measured=WiFi.status()==WL_CONNECTED && rssi>=-127 && rssi<0;
    writeDiagnostics(doc["diagnostics"].to<JsonObject>(),sample,FirmwareVersion,resetReasonCode(),
      {"wifi",measured?"rssi":nullptr,static_cast<int16_t>(measured?rssi:0)});
  }
  publish("/telemetry",doc);
}
} // namespace

void setup() {
  Serial.begin(115200);
  uuid(sessionId); baseTopic=String("techbaza/devices/")+KERUMO_DEVICE_UID;
  commands=xQueueCreate(8,sizeof(Command)); stopCommands=xQueueCreate(1,sizeof(Command));
  responses=xQueueCreate(24,sizeof(Record)); samples=xQueueCreate(1,sizeof(Sample));
  if (!commands || !stopCommands || !responses || !samples) { Serial.println("FATAL: task queue allocation"); while(true) delay(1000); }
  if (xTaskCreatePinnedToCore(deviceTask,"vfd",12288,nullptr,2,nullptr,1)!=pdPASS) { Serial.println("FATAL: VFD task allocation"); while(true) delay(1000); }
  sntp_set_time_sync_notification_cb(synchronized); configTime(0,0,"pool.ntp.org","time.cloudflare.com");
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(KERUMO_WIFI_SSID,KERUMO_WIFI_PASSWORD);
  transport.setCACert(KERUMO_MQTT_CA); transport.setHandshakeTimeout(5); transport.setTimeout(2000);
  mqtt.setId(String(KERUMO_DEVICE_UID)+"-esp32"); mqtt.setUsernamePassword(KERUMO_DEVICE_UID,KERUMO_MQTT_PASSWORD);
  mqtt.setCleanSession(true); mqtt.setConnectionTimeout(2000); mqtt.setKeepAliveInterval(5000); mqtt.onMessage(received);
  Serial.printf("KERUMO V3 test %s. Serial: ARM SU600 / ARM SU600 TEST / DISARM. No local HTTP command endpoint.\n",FirmwareVersion);
}
void loop() {
  static uint32_t reconnectAt=0,lastHeartbeat=0,lastTelemetry=0;
  static uint64_t sequence=0;
  static char line[32]{}; static size_t lineSize=0;
  static Record delivered[LedgerSize]{}; static size_t deliveredNext=0;
  while(Serial.available()) {
    char ch=Serial.read();
    if(ch=='\n') {
      line[lineSize]=0;
      if(strcmp(line,"ARM SU600")==0) localAction.store(1);
      else if(strcmp(line,"ARM SU600 TEST")==0) localAction.store(4);
      else if(strcmp(line,"DISARM")==0) localAction.store(2);
      lineSize=0;
    } else if (ch!='\r') { if(lineSize+1<sizeof(line)) line[lineSize++]=ch; else lineSize=0; }
  }
  if (WiFi.status()!=WL_CONNECTED || !deviceClock.utcMs()) { networkReady.store(false); delay(20); return; }
  if (!mqtt.connected()) {
    networkReady.store(false);
    if(static_cast<uint32_t>(millis()-reconnectAt)<3000) { delay(10); return; }
    reconnectAt=millis();
    if (!mqtt.connect(KERUMO_MQTT_HOST,KERUMO_MQTT_PORT) || !mqtt.subscribe(baseTopic+"/commands",1)) {
      Serial.printf("MQTT: reconnect failed (%d); check IP, CA, credentials and firewall\n",mqtt.connectError()); mqtt.stop(); return;
    }
    Serial.printf("MQTT CONNECTED / TLS: ESP32 IP=%s, host=%s:%d\n",WiFi.localIP().toString().c_str(),KERUMO_MQTT_HOST,KERUMO_MQTT_PORT);
    for(auto& record:delivered) record=Record{};
    localAction.store(3);
  }
  mqtt.poll(); networkCheckedMs.store(millis()); networkReady.store(mqtt.connected());
  Record response{};
  if (xQueueReceive(responses,&response,0)==pdTRUE) {
    bool seen=false;
    for(const auto& old:delivered) if(std::strcmp(old.command.id,response.command.id)==0 && old.outcome==response.outcome && old.error==response.error) seen=true;
    if(!seen && sendRecord(response)) { delivered[deliveredNext]=response; deliveredNext=(deliveredNext+1)%LedgerSize; }
  }
  const uint32_t now=millis();
  if(static_cast<uint32_t>(now-lastHeartbeat)>=3000) { JsonDocument doc; envelope(doc,sequence++,deviceClock.utcMs()); doc["session_id"]=sessionId; publish("/heartbeat",doc); lastHeartbeat=now; }
  if(static_cast<uint32_t>(now-lastTelemetry)>=3000) {
    Sample sample{}; if(xQueuePeek(samples,&sample,0)==pdTRUE) telemetry(sample,sequence++); lastTelemetry=now;
  }
  delay(5);
}
