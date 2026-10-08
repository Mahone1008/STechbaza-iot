#include "src/core.h"
#include "src/diagnostics.h"
#include "src/esp32_modbus.h"
#include "src/esp32_storage.h"
#include "src/esp32_provisioning.h"
#include "src/journal_upgrade.h"
#include "src/message_time.h"
#include "src/protocol.h"
#include "src/scoped_journal.h"
#include "src/su600_driver.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoMqttClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <atomic>
#include <ctime>
#include <esp_sntp.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <mbedtls/sha256.h>
#if __has_include("equipment_config.local.h")
#include "equipment_config.local.h"
#endif
#if __has_include("config.local.h")
#include "config.local.h"
#else
#include "config.example.h"
#endif
#if __has_include("factory_config.local.h")
#include "factory_config.local.h"
#endif
#if __has_include("lte_config.local.h")
#include "lte_config.local.h"
#endif
#ifndef KERUMO_USE_LTE
#define KERUMO_USE_LTE false
#endif
#if KERUMO_USE_LTE
#include "src/esp32_cellular.h"
#ifdef KERUMO_FACTORY_CONTROLLER_ID
#error "V4 LTE bench uses a pre-registered identity; factory LTE enrollment is not implemented"
#endif
#endif
#ifndef KERUMO_ENABLE_EXTENDED_TEST
#define KERUMO_ENABLE_EXTENDED_TEST false
#endif
#ifndef KERUMO_ENABLE_REMOTE_OPERATION
#define KERUMO_ENABLE_REMOTE_OPERATION false
#endif
static_assert(!KERUMO_ENABLE_REMOTE_OPERATION ||
                  (KERUMO_ENABLE_CONTROL && KERUMO_ENABLE_EXTENDED_TEST),
              "Remote operation requires control and the extended SU600 checks");

using namespace kerumo;
namespace {
constexpr char FirmwareVersion[] = "0.9.0";
EquipmentBinding equipment{};
bool managedEquipment = false;
Provisioning provisioning;
std::atomic<bool> locallyConfirmed{true};
std::atomic<bool> configurationRestartPending{false};
const char *deviceUid() { return provisioning.enabled ? provisioning.uid.c_str() : KERUMO_DEVICE_UID; }
const char *mqttHost() { return provisioning.enabled ? provisioning.host.c_str() : KERUMO_MQTT_HOST; }
const char *mqttPassword() { return provisioning.enabled ? provisioning.password.c_str() : KERUMO_MQTT_PASSWORD; }
uint16_t mqttPort() { return provisioning.enabled ? provisioning.port : KERUMO_MQTT_PORT; }

static_assert(sizeof(time_t) >= 8, "Calendar execution requires 64-bit time_t");
std::atomic<int64_t> syncEpochMs{0}, syncMonoMs{0};
std::atomic<bool> networkReady{false};
std::atomic<uint32_t> networkCheckedMs{0};
std::atomic<uint8_t> localAction{
    0}; // 1 arm, 2 disarm, 3 replay, 4 extended test, 5 confirm stopped equipment binding
QueueHandle_t commands, stopCommands, responses, samples;
char sessionId[37]{};
String baseTopic;
WiFiClientSecure transport;
MqttClient mqtt(transport);
HardwareSerial vfdSerial(1);
#if KERUMO_USE_LTE
A7670Port cellularPort;
CellularLink cellularLink(cellularPort, KERUMO_MODEM_APN);
#endif

void uuid(char *target) {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  snprintf(target, 37, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", bytes[0],
           bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9],
           bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]);
}
void synchronized(struct timeval *tv) {
  syncMonoMs.store(esp_timer_get_time() / 1000);
  syncEpochMs.store(static_cast<int64_t>(tv->tv_sec) * 1000 + tv->tv_usec / 1000);
}
class DeviceClock : public Clock {
public:
  uint32_t monotonicMs() const override { return millis(); }
  uint64_t uptimeMs() const override { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }
  int64_t utcMs() const override {
    const int64_t epoch = syncEpochMs.load(), age = esp_timer_get_time() / 1000 - syncMonoMs.load();
    return epoch > 1704067200000LL && age >= 0 && age < 3600000 ? epoch + age : 0;
  }
} deviceClock;
const char *resetReasonCode() {
  switch (esp_reset_reason()) {
  case ESP_RST_POWERON:
    return "power_on";
  case ESP_RST_EXT:
    return "external";
  case ESP_RST_SW:
    return "software";
  case ESP_RST_PANIC:
    return "panic";
  case ESP_RST_INT_WDT:
    return "interrupt_watchdog";
  case ESP_RST_TASK_WDT:
    return "task_watchdog";
  case ESP_RST_WDT:
    return "watchdog";
  case ESP_RST_DEEPSLEEP:
    return "deep_sleep";
  case ESP_RST_BROWNOUT:
    return "brownout";
  case ESP_RST_SDIO:
    return "sdio";
  default:
    return "unknown";
  }
}
NvsStorage storage(equipment, managedEquipment);
Modbus bus(vfdSerial, KERUMO_ENABLE_CONTROL);
class ResponseEvents : public Events {
public:
  void emit(const Record &record) override {
    // Network can stall without blocking the VFD task. Full queue is recovered by periodic replay.
    xQueueSend(responses, &record, 0);
  }
} events;
Su600Driver drive(bus);
Controller controller(drive, storage, deviceClock, events, KERUMO_ENABLE_CONTROL);

void deviceTask(void *) {
  vfdSerial.begin(9600, SERIAL_8N1, 18, 17);
  if (managedEquipment)
    drive.setInstallationLimits(equipment.minHz, equipment.maxHz);
  const bool ready = controller.begin(deviceUid());
  Serial.printf("V3: storage=%s mode=%s UID=%s\n", ready ? "OK" : "LOCKED",
                KERUMO_ENABLE_REMOTE_OPERATION ? "REMOTE / CHECKING" :
                KERUMO_ENABLE_CONTROL ? "CONTROL / DISARMED" : "READ ONLY", deviceUid());
  uint32_t lastSample = 0, lastReplay = 0;
  StopReason lastReason = StopReason::None;
  for (;;) {
    uint8_t action = localAction.exchange(0);
    if (configurationRestartPending.load() && action != 2)
      action = 0;
    if (action == 5) {
      DriveState state{};
      double hz{};
      drive.refreshConfig();
      const bool bound = !controller.isArmed() && drive.controlOk() && drive.readState(state) &&
                         drive.readOutputHz(hz) && confirmedStopped(state, hz) &&
                         (storage.needsBinding ? storage.bindStoppedEquipment(deviceUid(), provisioning.enabled) : managedEquipment) &&
                         controller.begin(deviceUid());
      if (bound && (!provisioning.enabled || provisioning.confirm())) locallyConfirmed.store(true);
      Serial.println(bound && locallyConfirmed.load() ? "EQUIPMENT BOUND; DISARMED. Old journal archived."
                           : "BIND DENIED: require managed manifest, pending binding, matching UID, valid "
                             "profile and stopped drive");
    }
    if (action == 1)
      Serial.println(locallyConfirmed.load() && controller.arm() ? "ARMED: SU600 bench, automatic STOP after 60 seconds"
                                      : "ARM DENIED: inspect configuration, clock and stopped state");
    if (action == 4)
      Serial.println(!KERUMO_ENABLE_EXTENDED_TEST
                         ? "ARM TEST DENIED: extended test is disabled in config.local.h"
                     : locallyConfirmed.load() && controller.arm(SessionMode::ExtendedTest)
                         ? "ARMED: SU600 EXTENDED TEST, no duration cap; normal STOP keeps permission"
                         : "ARM TEST DENIED: verify STOP, clock, profile, F6.02=5.0..10.0s, F5.00 "
                           "stop-on-loss + overload enabled, F4.08=0");
    if (action == 2) {
      controller.disarm();
      Serial.println("DISARMED; pending local STOP is retried until verified");
    }
    controller.tick(!configurationRestartPending.load() && networkReady.load() &&
                    static_cast<uint32_t>(millis() - networkCheckedMs.load()) < 8000,
                    KERUMO_ENABLE_REMOTE_OPERATION && locallyConfirmed.load() &&
                    !configurationRestartPending.load());
    if (controller.stopReason() != lastReason) {
      lastReason = controller.stopReason();
      Serial.printf("CONTROL: last_stop=%s armed=%d\n", stopReasonCode(lastReason), controller.isArmed());
    }
    Command command{};
    if (xQueueReceive(stopCommands, &command, 0) == pdTRUE ||
        xQueueReceive(commands, &command, 0) == pdTRUE) {
      // Config/readback can take time; do not execute after the network lease expires.
      if (configurationRestartPending.load() || !networkReady.load() ||
          static_cast<uint32_t>(millis() - networkCheckedMs.load()) >= 8000)
        controller.tick(false);
      char ack[37], result[37];
      uuid(ack);
      uuid(result);
      controller.receive(command, sessionId, ack, result);
    }
    const uint32_t now = millis();
    if (static_cast<uint32_t>(now - lastSample) >= 3000) {
      Sample sample = controller.sample();
      xQueueOverwrite(samples, &sample);
      lastSample = millis();
      const auto &c = drive.config();
      Serial.printf("SU600: read=%d profile=%d config=%d F0.02=%u F0.03=%u F0.04=%u F0.05=%u F0.06=%u "
                    "F6.00=%u F6.01=%u F6.02=%u F6.03=%u F6.04=%u F6.05=%u armed=%d\n",
                    c.readOk, c.profileOk(), c.controlOk(), c.runSource, c.frequencySource, c.maxRaw,
                    c.upperRaw, c.lowerRaw, c.address, c.serial, c.timeoutRaw, c.responseDelay, c.scaleRaw,
                    c.protocol, controller.isArmed());
      Serial.printf("TEST: session=%s guards_read=%d ready=%d F5.00=%04X (raw=%u) F4.08=%u last_stop=%s\n",
                    controller.sessionMode() == SessionMode::ExtendedTest ? "EXTENDED" : "BENCH",
                    c.protectionReadOk, c.extendedTestOk(), static_cast<unsigned>(c.protection),
                    static_cast<unsigned>(c.protection), c.autoReset,
                    stopReasonCode(controller.stopReason()));
      Serial.printf(
          "READ: fault=%s:%u state=%s:%u set=%s:%.2f out=%s:%.2f I=%s:%.1f U=%s:%.1f\n",
          sample.vfd.ok[0] ? "OK" : "MISSING", sample.vfd.fault, sample.vfd.ok[1] ? "OK" : "MISSING",
          sample.vfd.state.raw, sample.vfd.ok[2] ? "OK" : "MISSING", sample.vfd.setHz,
          sample.vfd.ok[3] ? "OK" : "MISSING", sample.vfd.outputHz, sample.vfd.ok[4] ? "OK" : "MISSING",
          sample.vfd.currentA, sample.vfd.ok[5] ? "OK" : "MISSING", sample.vfd.voltageV);
    }
    if (action == 3 || static_cast<uint32_t>(now - lastReplay) >= 10000) {
      controller.replay();
      lastReplay = now;
    }
    delay(10);
  }
}
void received(int size) {
  const bool valid =
      !mqtt.messageRetain() && mqtt.messageTopic() == baseTopic + "/commands" && size > 0 && size <= 1536;
  if (!valid) {
    Serial.println("COMMAND DROPPED: retained, wrong topic or oversized");
    networkReady.store(false);
    mqtt.stop();
    return;
  }
  char payload[1537];
  int count = 0;
  const uint32_t started = millis();
  while (count < size && static_cast<uint32_t>(millis() - started) < 2000) {
    const int byte = mqtt.read();
    if (byte < 0)
      break;
    payload[count++] = byte;
  }
  if (count != size) {
    Serial.println("COMMAND DROPPED: incomplete");
    networkReady.store(false);
    mqtt.stop();
    return;
  }
  Command command{};
  if (!parseCommand(payload, count, command, managedEquipment ? &equipment : nullptr)) {
    Serial.println("COMMAND DROPPED: invalid envelope or equipment binding");
    return;
  }
  BaseType_t queued;
  if (command.type == Type::Stop) {
    Command waiting{};
    // Keep the newest Stop even when ordinary commands fill their own queue.
    queued = xQueuePeek(stopCommands, &waiting, 0) == pdTRUE && waiting.sequence >= command.sequence
                 ? pdTRUE
                 : xQueueOverwrite(stopCommands, &command);
  } else
    queued = xQueueSend(commands, &command, 0);
  if (queued != pdTRUE)
    Serial.println("COMMAND QUEUE FULL: no execution, server may retry");
}
bool publish(const String &suffix, JsonDocument &doc) {
  if (!mqtt.connected())
    return false;
  String payload;
  serializeJson(doc, payload);
  if (!mqtt.beginMessage(baseTopic + suffix, static_cast<unsigned long>(payload.length()), false, 1))
    return false;
  mqtt.print(payload);
  return mqtt.endMessage() == 1;
}
void envelope(JsonDocument &doc, uint64_t sequence, int64_t at) {
  char message[37];
  uuid(message);
  doc["schema_version"] = 1;
  doc["message_id"] = message;
  doc["sequence"] = sequence;
  writeMessageTimestamp(doc, "sent_at", at);
}
bool sendRecord(const Record &r) {
  JsonDocument ack;
  ack["schema_version"] = 1;
  ack["message_id"] = r.ackId;
  ack["command_id"] = r.command.id;
  ack["session_id"] = r.session;
  writeMessageTimestamp(ack, "sent_at", r.acceptedMs);
  if (!publish("/commands/ack", ack))
    return false;
  if (r.outcome == Outcome::Pending || r.outcome == Outcome::Unknown)
    return true;
  JsonDocument result;
  result["schema_version"] = 1;
  result["message_id"] = r.resultId;
  result["command_id"] = r.command.id;
  result["session_id"] = r.session;
  writeMessageTimestamp(result, "sent_at", r.completedMs);
  result["status"] = r.outcome == Outcome::Succeeded ? "succeeded" : "failed";
  auto data = result["result"].to<JsonObject>();
  if (programType(r.command.type)) {
    data["steps_completed"] = r.stepsCompleted;
    data["step_count"] = r.command.program.count;
    data["stop_confirmed"] = r.programStopConfirmed;
  }
  if (r.outcome == Outcome::Succeeded) {
    data["frequency_hz"] = r.actualHz;
    result["error_code"] = nullptr;
    result["error_message"] = nullptr;
  } else {
    result["error_code"] = errorCode(r.error);
    result["error_message"] = errorCode(r.error);
  }
  return publish("/commands/result", result);
}
void telemetry(const Sample &sample, uint64_t sequence) {
  JsonDocument doc;
  envelope(doc, sequence, sample.sampledUtcMs);
  doc["session_id"] = sessionId;
  auto values = doc["values"].to<JsonObject>();
  auto state = doc["state"].to<JsonObject>();
  // Never re-label an old sample as current after a network stall.
  const bool fresh = static_cast<uint32_t>(millis() - sample.sampledMs) < 5000;
  if (fresh && sample.storageOk && sample.sampledUtcMs > 0)
    doc["command_sequence_floor"] = sample.commandSequence;
  const char *keys[] = {"vfd.set_frequency_hz", "vfd.frequency_hz", "vfd.current_a", "vfd.voltage_v"};
  const double readings[] = {sample.vfd.setHz, sample.vfd.outputHz, sample.vfd.currentA, sample.vfd.voltageV};
  for (size_t i = 0; i < 4; ++i)
    if (fresh && sample.vfd.ok[i + 2])
      values[keys[i]] = readings[i];
  if (fresh && sample.vfd.ok[0])
    state["vfd_fault_code"] = sample.vfd.fault;
  if (fresh && sample.vfd.ok[1] && sample.vfd.state.running)
    state["pump_running"] = true;
  if (fresh && sample.vfd.ok[1] && sample.vfd.state.stopped)
    state["pump_running"] = false;
  state["vfd_link"] = fresh && sample.vfd.ok[0] && sample.vfd.ok[1] && sample.vfd.ok[3];
  state["vfd_configuration_valid"] = fresh && sample.configOk;
  state["control_armed"] = fresh && sample.armed && sample.storageOk;
  if (fresh) {
#if KERUMO_USE_LTE
    int16_t rssi = 0;
    const bool measured = cellularPort.signal(rssi);
    const char *channel = "cellular";
#else
    const int32_t rssi = WiFi.RSSI();
    const bool measured = WiFi.status() == WL_CONNECTED && rssi >= -127 && rssi < 0;
    const char *channel = "wifi";
#endif
    writeDiagnostics(doc["diagnostics"].to<JsonObject>(), sample, FirmwareVersion, resetReasonCode(),
                     {channel, measured ? "rssi" : nullptr, static_cast<int16_t>(measured ? rssi : 0)});
    if (managedEquipment)
      writeEquipment(doc["diagnostics"]["equipment"].to<JsonObject>(), equipment,
                     sample.configOk && sample.storageOk && locallyConfirmed.load());
  }
  publish("/telemetry", doc);
}
} // namespace

void setup() {
  Serial.begin(115200);
#ifdef KERUMO_FACTORY_CONTROLLER_ID
  if (!provisioning.begin(KERUMO_FACTORY_CONTROLLER_ID, KERUMO_BOOTSTRAP_KEY, KERUMO_API_URL,
                          KERUMO_MQTT_CA, KERUMO_SETUP_PASSWORD)) {
    Serial.println("FATAL: invalid factory provisioning; VFD I/O disabled");
    while (true) delay(1000);
  }
#endif
#ifdef KERUMO_EQUIPMENT_JSON
  const char *manifest = provisioning.enabled ? provisioning.manifest.c_str() : KERUMO_EQUIPMENT_JSON;
#else
  const char *manifest = provisioning.enabled ? provisioning.manifest.c_str() : "";
#endif
  if (std::strlen(manifest)) {
  uint8_t digest[32]{};
  if (!parseEquipment(manifest, std::strlen(manifest), deviceUid(), equipment) ||
      mbedtls_sha256(reinterpret_cast<const unsigned char *>(manifest), std::strlen(manifest), digest, 0) !=
          0) {
    Serial.println("FATAL: invalid or unsupported equipment manifest; VFD I/O disabled");
    while (true)
      delay(1000);
  }
  for (size_t i = 0; i < 32; ++i)
    snprintf(equipment.hash + i * 2, 3, "%02x", digest[i]);
  managedEquipment = true;
  }
  locallyConfirmed.store(!provisioning.enabled || provisioning.confirmed());
  uuid(sessionId);
  baseTopic = String("techbaza/devices/") + deviceUid();
  commands = xQueueCreate(8, sizeof(Command));
  stopCommands = xQueueCreate(1, sizeof(Command));
  responses = xQueueCreate(24, sizeof(Record));
  samples = xQueueCreate(1, sizeof(Sample));
  if (!commands || !stopCommands || !responses || !samples) {
    Serial.println("FATAL: task queue allocation");
    while (true)
      delay(1000);
  }
  if ((!provisioning.enabled || managedEquipment) && xTaskCreatePinnedToCore(deviceTask, "vfd", 12288, nullptr, 2, nullptr, 1) != pdPASS) {
    Serial.println("FATAL: VFD task allocation");
    while (true)
      delay(1000);
  }
  sntp_set_time_sync_notification_cb(synchronized);
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
#if KERUMO_USE_LTE
  WiFi.mode(WIFI_OFF);
  Serial.println("V4 LTE: UART2 TX=4 RX=5; PPP, ESP32 SNTP and verified TLS; Wi-Fi off");
#else
  if (!provisioning.enabled) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(KERUMO_WIFI_SSID, KERUMO_WIFI_PASSWORD);
  }
#endif
  transport.setCACert(KERUMO_MQTT_CA);
  transport.setHandshakeTimeout(5);
  transport.setTimeout(2000);
  mqtt.setId(String(deviceUid()) + "-esp32");
  mqtt.setUsernamePassword(deviceUid(), mqttPassword());
  mqtt.setCleanSession(true);
  mqtt.setConnectionTimeout(2000);
  mqtt.setKeepAliveInterval(5000);
  mqtt.onMessage(received);
  Serial.printf(
      "KERUMO V3 test %s. Serial: ARM SU600 / ARM SU600 TEST / DISARM. No local HTTP command endpoint.\n",
      FirmwareVersion);
}
void loop() {
  static uint32_t reconnectAt = 0, lastHeartbeat = 0, lastTelemetry = 0;
  static uint64_t sequence = 0;
  static char line[32]{};
  static size_t lineSize = 0;
  static Record delivered[LedgerSize]{};
  static size_t deliveredNext = 0;
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') {
      line[lineSize] = 0;
      if (strcmp(line, "ARM SU600") == 0)
        localAction.store(1);
      else if (strcmp(line, "ARM SU600 TEST") == 0)
        localAction.store(4);
      else if (strcmp(line, "BIND EQUIPMENT STOPPED") == 0)
        localAction.store(5);
      else if (strcmp(line, "DISARM") == 0)
        localAction.store(2);
      lineSize = 0;
    } else if (ch != '\r') {
      if (lineSize + 1 < sizeof(line))
        line[lineSize++] = ch;
      else
        lineSize = 0;
    }
  }
  if (provisioning.enabled) {
    static bool wantsPortal = false;
    static uint32_t restartRequestedAt = 0;
    Sample state{};
    const bool fresh = xQueuePeek(samples, &state, 0) == pdTRUE && millis() - state.sampledMs < 5000;
    const bool stopped = !managedEquipment || (fresh && !state.armed && state.vfd.ok[1] && state.vfd.ok[3] &&
                                               confirmedStopped(state.vfd.state, state.vfd.outputHz));
    if (configurationRestartPending.load()) {
      networkReady.store(false);
      mqtt.stop();
      // STOP до HTTP-запиту міг застаріти. ARM заблоковано, а VFD task
      // виконує DISARM/STOP; перезапуск лише після нового локального readback.
      if (!managedEquipment || (stopped && static_cast<int32_t>(state.sampledMs - restartRequestedAt) > 0))
        ESP.restart();
      delay(20);
      return;
    }
    if (provisioning.buttonHeld()) { wantsPortal = true; localAction.store(2); }
    if (wantsPortal && stopped) { provisioning.openPortal(); wantsPortal = false; }
    provisioning.loop();
    if (provisioning.takeBind()) localAction.store(5);
    if (provisioning.activePortal()) {
      networkReady.store(false); mqtt.stop(); delay(5); return;
    }
    if (WiFi.status() == WL_CONNECTED && deviceClock.utcMs() && provisioning.poll(FirmwareVersion, stopped)) {
      restartRequestedAt = millis();
      configurationRestartPending.store(true);
      networkReady.store(false);
      localAction.store(2);
      mqtt.stop();
      Serial.println("CONFIGURATION STORED: waiting for fresh local STOP before restart");
      return;
    }
    if (provisioning.suspended || provisioning.uid.isEmpty()) {
      networkReady.store(false); mqtt.stop(); delay(20); return;
    }
  }
#if KERUMO_USE_LTE
  if (!cellularPort.online())
    networkReady.store(false);
  const bool linkUp = cellularLink.tick(millis());
  static bool previouslyUp = false;
  if (linkUp && !previouslyUp) {
    PPP.setDefault();
    Serial.printf("LTE: PPP address=%s; waiting for ESP32 UTC synchronization\n",
                  PPP.localIP().toString().c_str());
  }
  previouslyUp = linkUp;
#else
  const bool linkUp = WiFi.status() == WL_CONNECTED;
#endif
  if (!linkUp || !deviceClock.utcMs()) {
    networkReady.store(false);
    mqtt.stop();
    delay(20);
    return;
  }
  if (!mqtt.connected()) {
    networkReady.store(false);
    if (static_cast<uint32_t>(millis() - reconnectAt) < 3000) {
      delay(10);
      return;
    }
    reconnectAt = millis();
    if (!mqtt.connect(mqttHost(), mqttPort()) || !mqtt.subscribe(baseTopic + "/commands", 1)) {
      Serial.printf("MQTT: reconnect failed (%d); check IP, CA, credentials and firewall\n",
                    mqtt.connectError());
      mqtt.stop();
      return;
    }
#if KERUMO_USE_LTE
    const String localIp = PPP.localIP().toString();
#else
    const String localIp = WiFi.localIP().toString();
#endif
    Serial.printf("MQTT CONNECTED / TLS: ESP32 IP=%s, host=%s:%d\n", localIp.c_str(),
                  mqttHost(), mqttPort());
    for (auto &record : delivered)
      record = Record{};
    localAction.store(3);
  }
  mqtt.poll();
  networkCheckedMs.store(millis());
  networkReady.store(mqtt.connected());
  Record response{};
  if (xQueueReceive(responses, &response, 0) == pdTRUE) {
    bool seen = false;
    for (const auto &old : delivered)
      if (std::strcmp(old.command.id, response.command.id) == 0 && old.outcome == response.outcome &&
          old.error == response.error)
        seen = true;
    if (!seen && sendRecord(response)) {
      delivered[deliveredNext] = response;
      deliveredNext = (deliveredNext + 1) % LedgerSize;
    }
  }
  const uint32_t now = millis();
  if (static_cast<uint32_t>(now - lastHeartbeat) >= 3000) {
    JsonDocument doc;
    envelope(doc, sequence++, deviceClock.utcMs());
    doc["session_id"] = sessionId;
    publish("/heartbeat", doc);
    lastHeartbeat = now;
  }
  if (static_cast<uint32_t>(now - lastTelemetry) >= 3000) {
    Sample sample{};
    if (xQueuePeek(samples, &sample, 0) == pdTRUE)
      telemetry(sample, sequence++);
    lastTelemetry = now;
  }
  delay(5);
}
