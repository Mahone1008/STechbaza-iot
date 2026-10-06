#include "../kerumo_v3/src/message_time.h"
#include <cassert>
#include <iostream>
#include <string>

constexpr int64_t SampleUtcMs = 1791288000123LL;

void identity(JsonDocument &document) {
  document["schema_version"] = 1;
  document["message_id"] = "bf34a0e0-44db-4d06-8aba-df8df0b3002b";
  document["session_id"] = "bef7667f-ea62-471d-a9a9-2b6b3b815c07";
}

void emit(const char *kind, const JsonDocument &document) {
  std::cout << kind << '\t';
  serializeJson(document, std::cout);
  std::cout << '\n';
}

void telemetry(const char *kind, int64_t utcMs) {
  JsonDocument document;
  identity(document);
  document["sequence"] = 7;
  kerumo::writeMessageTimestamp(document, "sent_at", utcMs);
  if (utcMs) document["command_sequence_floor"] = 83;
  document["values"]["vfd.frequency_hz"] = 0;
  document["state"]["control_armed"] = true;
  assert(document["sequence"] == 7);
  assert(document["sent_at"].isNull() == !utcMs);
  emit(kind, document);
}

void response(const char *kind, bool result, int64_t utcMs) {
  JsonDocument document;
  identity(document);
  document["command_id"] = "d0d7f248-c935-4bcb-a01f-c623ee716d89";
  kerumo::writeMessageTimestamp(document, "sent_at", utcMs);
  if (result) {
    document["status"] = "succeeded";
    document["result"]["frequency_hz"] = 0;
  }
  emit(kind, document);
}

int main() {
  // Missing field, explicit null, replacement and serialized string lifetime.
  JsonDocument document;
  kerumo::writeMessageTimestamp(document, "sent_at", 0);
  assert(document.as<JsonObject>().size() == 1);
  assert(document["sent_at"].isNull());
  document["other"] = 42;
  kerumo::writeMessageTimestamp(document, "sent_at", SampleUtcMs);
  std::string encoded;
  serializeJson(document, encoded);
  JsonDocument decoded;
  assert(!deserializeJson(decoded, encoded));
  assert(decoded["sent_at"] == "2026-10-06T12:00:00Z");
  assert(decoded["other"] == 42);
  kerumo::writeMessageTimestamp(document, "sent_at", 2208988800000LL);
  assert(document["sent_at"] == "2040-01-01T00:00:00Z");
  kerumo::writeMessageTimestamp(document, "sent_at", 0);
  assert(document["sent_at"].isNull());
  assert(document["other"] == 42);

  telemetry("telemetry", SampleUtcMs);
  telemetry("telemetry_no_clock", 0);
  telemetry("telemetry_after2038", 2208988800000LL);
  response("ack", false, SampleUtcMs);
  response("ack_no_clock", false, 0);
  response("result", true, SampleUtcMs);
  response("result_no_clock", true, 0);
}
