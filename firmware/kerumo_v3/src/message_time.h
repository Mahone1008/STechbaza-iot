#pragma once
#include <ArduinoJson.h>
#include <cstdint>
#include <ctime>

namespace kerumo {
inline void writeMessageTimestamp(JsonDocument &document, const char *field, int64_t ms) {
  // Assign through the member proxy: converting an absent member to JsonVariant
  // yields an unbound target and silently drops the timestamp in ArduinoJson 7.
  if (!ms) {
    document[field] = nullptr;
    return;
  }
  const time_t seconds = ms / 1000;
  struct tm utc{};
  gmtime_r(&seconds, &utc);
  char value[32];
  strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%SZ", &utc);
  document[field] = value;
}
} // namespace kerumo
