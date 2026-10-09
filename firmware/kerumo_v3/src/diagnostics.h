#pragma once
#include <ArduinoJson.h>
#include <ctime>
#include "core.h"

namespace kerumo {
struct ConnectionDiagnostic {
  const char* transport;
  const char* metric; // nullptr, якщо вимірювання радіосигналу недоступне
  int16_t dbm;
};

// Без залежності від Wi-Fi/LTE: мережевий адаптер плати надає власне вимірювання.
inline void writeDiagnostics(JsonObject target, const Sample& sample,
    const char* firmwareVersion, const char* resetReason, const ConnectionDiagnostic& connection) {
  target["version"]=1;
  target["firmware_version"]=firmwareVersion;
  target["uptime_ms"]=sample.uptimeMs;
  target["reset_reason"]=resetReason;
  const auto& progress=sample.program;
  auto program=target["program"].to<JsonObject>();
  program["version"]=1; program["ready"]=progress.ready;
  program["supports_schedule"]=true;
  program["max_schedule_seconds"]=MaxScheduleSeconds;
  if (progress.phase==ProgramPhase::Idle) program["command_id"]=nullptr;
  else program["command_id"]=progress.commandId;
  program["state"]=programPhaseCode(progress.phase);
  program["step_index"]=progress.step; program["step_count"]=progress.count;
  if (progress.phase==ProgramPhase::Idle) program["target_frequency_hz"]=nullptr;
  else program["target_frequency_hz"]=progress.targetHz;
  if (progress.phase==ProgramPhase::Holding) program["remaining_seconds"]=progress.remainingSeconds;
  else program["remaining_seconds"]=nullptr;
  if (sample.programReason==StopReason::None) program["reason"]=nullptr;
  else program["reason"]=stopReasonCode(sample.programReason);
  auto link=target["connection"].to<JsonObject>();
  link["transport"]=connection.transport;
  if (connection.metric) {
    auto signal=link["signal"].to<JsonObject>();
    signal["metric"]=connection.metric;
    signal["dbm"]=connection.dbm;
  } else link["signal"]=nullptr;
  if (sample.settings.supported) {
    auto settings = target["vfd_settings"].to<JsonObject>();
    settings["version"] = 1;
    settings["driver_id"] = "su600";
    settings["ready"] = sample.settingsReady;
    settings["command_sequence"] = sample.commandSequence;
    if (sample.settings.readOk && sample.settings.runSource <= 2 && sample.settings.frequencySource <= 7) {
      settings["run_source"] = sample.settings.runSource;
      settings["frequency_source"] = sample.settings.frequencySource;
    } else { settings["run_source"] = nullptr; settings["frequency_source"] = nullptr; }
    auto parameters = settings["parameters"].to<JsonObject>();
    if (sample.settings.accelerationOk) parameters["F0.10"] = sample.settings.acceleration;
    else parameters["F0.10"] = nullptr;
    if (sample.settings.decelerationOk) parameters["F0.11"] = sample.settings.deceleration;
    else parameters["F0.11"] = nullptr;
  }
  if (sample.lastStop.reason==StopReason::None) { target["last_stop"]=nullptr; return; }
  auto stop=target["last_stop"].to<JsonObject>();
  stop["reason"]=stopReasonCode(sample.lastStop.reason);
  stop["uptime_ms"]=sample.lastStop.uptimeMs;
  stop["confirmed"]=sample.lastStop.confirmed;
  if (sample.lastStop.requestedUtcMs) {
    const time_t seconds=sample.lastStop.requestedUtcMs/1000;
    struct tm utc{}; gmtime_r(&seconds,&utc);
    char value[32]; strftime(value,sizeof(value),"%Y-%m-%dT%H:%M:%SZ",&utc);
    stop["requested_at"]=value;
  } else stop["requested_at"]=nullptr;
}
} // namespace kerumo
