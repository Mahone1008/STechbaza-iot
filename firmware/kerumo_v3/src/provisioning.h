#pragma once
#include "equipment.h"

namespace kerumo {
inline uint32_t factoryGeneration(const char *uid, const char *controllerId) {
  if (!uid || !validUuid(controllerId) || std::strncmp(uid, "FC-", 3) != 0) return false;
  size_t offset = 3;
  for (size_t i=0; i<36; ++i) {
    if (controllerId[i] == '-') continue;
    if (uid[offset++] != controllerId[i]) return false;
  }
  if (uid[offset++] != '-' || uid[offset++] != 'G' || uid[offset] < '1' || uid[offset] > '9') return false;
  uint64_t generation = 0;
  for (; uid[offset]; ++offset) {
    if (uid[offset] < '0' || uid[offset] > '9') return false;
    generation = generation*10 + static_cast<unsigned>(uid[offset]-'0');
    if (generation > 2147483647) return false;
  }
  return static_cast<uint32_t>(generation);
}

inline bool factoryUid(const char *uid, const char *controllerId) { return factoryGeneration(uid, controllerId) > 0; }

inline bool enrollmentFields(JsonDocument &doc, const char *controllerId) {
  const char *uid = doc["device_uid"] | "", *host = doc["mqtt_host"] | "", *password = doc["mqtt_password"] | "";
  if (!factoryUid(uid, controllerId) || !*host || std::strlen(host) > 253 ||
      std::strlen(password) < 32 || std::strlen(password) > 100 ||
      !doc["mqtt_port"].is<unsigned>() || doc["mqtt_port"].as<unsigned>() == 0 || doc["mqtt_port"].as<unsigned>() > 65535 ||
      !doc["credential_revision"].is<uint32_t>() || doc["credential_revision"].as<uint32_t>() == 0) return false;
  for (const char *cursor=host; *cursor; ++cursor)
    if (!( (*cursor>='a' && *cursor<='z') || (*cursor>='A' && *cursor<='Z') ||
           (*cursor>='0' && *cursor<='9') || *cursor=='.' || *cursor=='-')) return false;
  return true;
}
} // namespace kerumo
