#pragma once
#include "equipment.h"

namespace kerumo {
enum class ControlGrantMode : uint8_t { ReadOnly, Bench, Extended };
inline const char *controlGrantModeCode(ControlGrantMode mode) {
  return mode == ControlGrantMode::Extended ? "extended_test" :
      mode == ControlGrantMode::Bench ? "bench_without_motor" : "read_only";
}
struct ServerControlGrant {
  uint32_t revision{};
  ControlGrantMode mode{ControlGrantMode::ReadOnly};
  bool commissioned{}, current{};
  // A cached response is only an anti-rollback watermark, never permission.
  bool read(JsonDocument &doc, bool live) {
    current = false;
    if (!doc["commissioned"].is<bool>() || !doc["control_revision"].is<uint32_t>()) return false;
    const uint32_t nextRevision = doc["control_revision"].as<uint32_t>();
    if (nextRevision > 2147483647U || nextRevision < revision) return false;
    const char *code = doc["control_mode"] | "";
    ControlGrantMode nextMode;
    if (std::strcmp(code, "read_only") == 0) nextMode = ControlGrantMode::ReadOnly;
    else if (std::strcmp(code, "bench_without_motor") == 0) nextMode = ControlGrantMode::Bench;
    else if (std::strcmp(code, "extended_test") == 0) nextMode = ControlGrantMode::Extended;
    else return false;
    const bool nextCommissioned = doc["commissioned"].as<bool>();
    if (nextCommissioned && !nextRevision) return false;
    if (!nextCommissioned && nextMode != ControlGrantMode::ReadOnly) return false;
    if (known_ && nextRevision == revision && (mode != nextMode || commissioned != nextCommissioned)) return false;
    revision = nextRevision; mode = nextMode; commissioned = nextCommissioned; known_ = true; current = live;
    return true;
  }
  bool permits(bool bound, bool controlCapable, bool extendedCapable) const {
    return current && commissioned && bound && controlCapable &&
        (mode == ControlGrantMode::Bench || (mode == ControlGrantMode::Extended && extendedCapable));
  }
private:
  bool known_{};
};
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

// A server response cannot rewind an ownership generation or the credential
// revision of the current owner. An empty cache still requires a valid factory UID.
inline bool enrollmentRevisionAllowed(JsonDocument &doc, const char *controllerId,
                                      const char *currentUid, uint32_t currentRevision) {
  if (!enrollmentFields(doc, controllerId)) return false;
  const char *nextUid = doc["device_uid"] | "";
  const uint32_t generation = factoryGeneration(nextUid, controllerId);
  const uint32_t currentGeneration = factoryGeneration(currentUid, controllerId);
  return generation > currentGeneration ||
      (generation == currentGeneration && (doc["credential_revision"] | 0U) >= currentRevision);
}
} // namespace kerumo
