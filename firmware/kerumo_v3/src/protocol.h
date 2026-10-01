#pragma once
#include "core.h"
#include <ArduinoJson.h>
#include <cstring>
#include <cmath>

namespace kerumo {
inline bool parseCommand(const char* bytes,size_t length,Command& out) {
  if (!length || length>1536 || std::memchr(bytes,0,length)) return false;
  JsonDocument doc;
  if (deserializeJson(doc,bytes,length,DeserializationOption::NestingLimit(4))) return false;
  if (!doc.is<JsonObject>() || doc.as<JsonObject>().size()!=9 || !doc["schema_version"].is<int>() || doc["schema_version"].as<int>()!=2) return false;
  if (!doc["control_sequence"].is<uint64_t>() || !doc["ttl_seconds"].is<unsigned>()) return false;
  const char* id=doc["command_id"] | "";
  if (!validUuid(id) || !validUuid(doc["request_id"] | "")) return false;
  out={}; std::strncpy(out.id,id,36);
  std::strncpy(out.requestId,doc["request_id"].as<const char*>(),36);
  out.sequence=doc["control_sequence"].as<uint64_t>();
  const unsigned ttl=doc["ttl_seconds"].as<unsigned>();
  if (out.sequence==0 || out.sequence>MaxSequence || ttl<5 || ttl>300) return false;
  out.ttl=ttl;
  if (!parseUtcMs(doc["issued_at"] | "",out.issuedMs) || !parseUtcMs(doc["expires_at"] | "",out.expiresMs) ||
      out.expiresMs-out.issuedMs!=ttl*1000LL) return false;
  const char* type=doc["command_type"] | "";
  if (std::strcmp(type,"vfd.start")==0) out.type=Type::Start;
  else if (std::strcmp(type,"vfd.stop")==0) out.type=Type::Stop;
  else if (std::strcmp(type,"vfd.frequency.set")==0) out.type=Type::Frequency;
  else if (std::strcmp(type,"vfd.program.start")==0) out.type=Type::Program;
  else if (std::strcmp(type,"vfd.schedule.start")==0) out.type=Type::Schedule;
  else return false;
  if (!doc["payload"].is<JsonObject>()) return false;
  auto payload=doc["payload"].as<JsonObject>();
  if (out.type==Type::Frequency) {
    if (payload.size()!=1 || !payload["frequency_hz"].is<double>() || payload["frequency_hz"].is<bool>()) return false;
    out.hz=payload["frequency_hz"].as<double>();
    if (!std::isfinite(out.hz) || out.hz<0 || out.hz>100) return false;
  } else if (programType(out.type)) {
    if (payload.size()!=(out.type==Type::Schedule?4U:2U) || !payload["version"].is<int>() || payload["version"].as<int>()!=1 || !payload["steps"].is<JsonArray>()) return false;
    const auto steps=payload["steps"].as<JsonArray>();
    if (steps.size()==0 || steps.size()>MaxProgramSteps) return false;
    out.program.count=steps.size();
    size_t i=0;
    for (auto raw:steps) {
      if (!raw.is<JsonObject>() || raw.as<JsonObject>().size()!=2 ||
          !raw["frequency_hz"].is<double>() || raw["frequency_hz"].is<bool>() ||
          !raw["duration_seconds"].is<uint32_t>()) return false;
      out.program.steps[i++]={raw["frequency_hz"].as<double>(),raw["duration_seconds"].as<uint32_t>()};
    }
    if (!validProgram(out.program,out.type==Type::Schedule?MaxScheduleSeconds:MaxProgramSeconds)) return false;
    if (out.type==Type::Schedule) {
      if (!parseUtcMs(payload["starts_at"] | "",out.scheduledStartMs) ||
          !parseUtcMs(payload["stops_at"] | "",out.scheduledStopMs)) return false;
      int64_t duration=0;
      for (size_t n=0;n<out.program.count;++n) duration+=out.program.steps[n].seconds*1000LL;
      if (out.scheduledStartMs%1000 || out.scheduledStopMs%1000 || out.scheduledStopMs-out.scheduledStartMs!=duration) return false;
    }
  } else if (payload.size()!=0) return false;
  return true;
}
} // namespace kerumo
