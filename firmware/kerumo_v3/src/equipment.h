#pragma once
#include "core.h"
#include "profile_revision.h"
#include <ArduinoJson.h>
#include <cstring>
#include <cmath>

namespace kerumo {
inline bool validHash(const char* text) {
  if (!text || std::strlen(text)!=64) return false;
  for (size_t i=0;i<64;++i) if (!((text[i]>='0' && text[i]<='9') || (text[i]>='a' && text[i]<='f'))) return false;
  return true;
}
struct EquipmentBinding {
  char moduleId[37]{}, bindingId[37]{}, hash[65]{};
  uint32_t generation{}, revision{};
  double minHz{}, maxHz{50};
};
// SHA-256 is computed from these exact manifest bytes by the platform adapter.
// No discovery-by-register-reading, no fallback to SU600 on an unknown profile.
inline bool parseEquipment(const char* bytes, size_t length, const char* uid, EquipmentBinding& out) {
  if (!length || length>2048 || std::memchr(bytes,0,length)) return false;
  JsonDocument doc;
  if (deserializeJson(doc,bytes,length,DeserializationOption::NestingLimit(3)) ||
      !doc.is<JsonObject>() || doc.size()!=13 || !doc["version"].is<int>() || doc["version"].as<int>()!=1 ||
      std::strcmp(doc["device_uid"] | "",uid)!=0 ||
      std::strcmp(doc["profile_id"] | "","suswe.su600.modbus")!=0 ||
      !doc["profile_version"].is<int>() || doc["profile_version"].as<int>()!=1 ||
      std::strcmp(doc["profile_hash"] | "",Su600ProfileHash)!=0 ||
      std::strcmp(doc["driver_id"] | "","suswe.su600")!=0 ||
      !doc["driver_version"].is<int>() || doc["driver_version"].as<int>()!=1 ||
      !validUuid(doc["module_id"] | "") || !validUuid(doc["binding_id"] | "")) return false;
  for (const char* key:{"binding_generation","revision"})
    if (!doc[key].is<uint32_t>() || doc[key].as<uint32_t>()==0 || doc[key].as<uint32_t>()>2147483647U) return false;
  auto bus=doc["bus"].as<JsonObject>();
  if (bus.size()!=5 || std::strcmp(bus["transport"] | "","modbus_rtu")!=0 ||
      !bus["address"].is<int>() || bus["address"].as<int>()!=1 ||
      !bus["baud"].is<int>() || bus["baud"].as<int>()!=9600 ||
      std::strcmp(bus["parity"] | "","none")!=0 || !bus["stop_bits"].is<int>() || bus["stop_bits"].as<int>()!=1) return false;
  auto limits=doc["frequency_limits"].as<JsonObject>();
  if (limits.size()!=2 || !limits["min_hz"].is<double>() || limits["min_hz"].is<bool>() ||
      !limits["max_hz"].is<double>() || limits["max_hz"].is<bool>()) return false;
  const double min=limits["min_hz"].as<double>(), max=limits["max_hz"].as<double>();
  if (!std::isfinite(min) || !std::isfinite(max) || min<0 || max>50 || min>=max) return false;
  out={};
  std::strncpy(out.moduleId,doc["module_id"].as<const char*>(),36);
  std::strncpy(out.bindingId,doc["binding_id"].as<const char*>(),36);
  out.generation=doc["binding_generation"].as<uint32_t>(); out.revision=doc["revision"].as<uint32_t>();
  out.minHz=min; out.maxHz=max;
  return true;
}
inline bool matchingTarget(JsonVariantConst raw, const EquipmentBinding& binding) {
  return raw.is<JsonObjectConst>() && raw.size()==3 && validHash(binding.hash) &&
    std::strcmp(raw["binding_id"] | "",binding.bindingId)==0 &&
    raw["revision"].is<uint32_t>() && raw["revision"].as<uint32_t>()==binding.revision &&
    std::strcmp(raw["configuration_hash"] | "",binding.hash)==0;
}
inline void writeEquipment(JsonObject target, const EquipmentBinding& binding, bool compatible) {
  target["module_id"]=binding.moduleId; target["binding_id"]=binding.bindingId;
  target["binding_generation"]=binding.generation; target["revision"]=binding.revision;
  target["configuration_hash"]=binding.hash;
  target["profile_id"]="suswe.su600.modbus"; target["profile_version"]=1; target["profile_hash"]=Su600ProfileHash;
  target["driver_id"]="suswe.su600"; target["driver_version"]=1; target["command_protocol"]=3;
  target["compatible"]=compatible;
}
} // namespace kerumo
