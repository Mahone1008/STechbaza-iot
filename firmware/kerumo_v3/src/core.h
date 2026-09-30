#pragma once
#include <cstddef>
#include <cstdint>

namespace kerumo {
constexpr size_t LedgerSize = 8;
constexpr uint64_t MaxSequence = 9007199254740991ULL;
constexpr uint32_t AutoStopMs = 60000;
enum class SessionMode : uint8_t { Bench, ExtendedTest };
enum class StopReason : uint8_t { None, Command, LocalDisarm, BenchTimer, Network, Link, Fault, Config, Storage, Unconfirmed, Restart };
const char* stopReasonCode(StopReason reason);
enum class Type : uint8_t { Start, Stop, Frequency };
enum class Outcome : uint8_t { Empty, Pending, Succeeded, Failed, Unknown };
enum class Error : uint8_t {
  None, ReadOnly, NotArmed, Clock, Expired, Stale, Config, Fault,
  Frequency, Busy, Storage, Unconfirmed, Restarted
};
const char* errorCode(Error error);
struct Command {
  char id[37]{};
  char requestId[37]{};
  uint64_t sequence{};
  int64_t issuedMs{}, expiresMs{};
  uint16_t ttl{};
  Type type{};
  double hz{};
};
struct Record {
  Command command{};
  char ackId[37]{}, resultId[37]{}, session[37]{};
  int64_t acceptedMs{}, completedMs{};
  Outcome outcome{Outcome::Empty};
  Error error{Error::None};
  double actualHz{};
};
// One committed NVS blob contains the sequence, intent, responses and run latch.
struct Journal {
  uint32_t magic{0x4B563301};
  uint32_t checksum{};
  char uid[97]{};
  uint64_t highest{};
  uint8_t next{};
  bool motionPossible{};
  Record records[LedgerSize]{};
};
uint32_t checksum(const Journal& value);
bool sameCommand(const Command& a, const Command& b);
bool validUuid(const char* text);
bool parseUtcMs(const char* text, int64_t& result);
uint16_t modbusCrc(const uint8_t* bytes, size_t size);
bool readResponse(const uint8_t* bytes, size_t size, uint8_t slave, uint16_t& value);
bool writeResponse(const uint8_t* bytes, size_t size, const uint8_t request[8]);

struct Bus {
  virtual ~Bus() = default;
  virtual bool read(uint16_t address, uint16_t& value) = 0;
  virtual bool write(uint16_t address, uint16_t value) = 0;
};
struct Storage {
  virtual ~Storage() = default;
  // 0 = new namespace, 1 = loaded, -1 = corrupt/unavailable. Never erase to recover.
  virtual int load(Journal& value) = 0;
  virtual bool save(const Journal& value) = 0;
};
struct Clock {
  virtual ~Clock() = default;
  virtual uint32_t monotonicMs() const = 0;
  virtual int64_t utcMs() const = 0; // zero if UTC has not been synchronized recently
};
struct Events {
  virtual ~Events() = default;
  virtual void emit(const Record& record) = 0;
};
struct Su600Config {
  uint16_t runSource{}, frequencySource{}, maxRaw{}, upperRaw{}, lowerRaw{};
  uint16_t address{}, serial{}, timeoutRaw{}, responseDelay{}, scaleRaw{}, protocol{};
  bool readOk{};
  uint16_t protection{}, autoReset{}; // F5.00 keeps its raw, four-bits-per-digit register encoding.
  bool protectionReadOk{};
  bool profileOk() const;
  bool controlOk() const;
  bool extendedTestOk() const;
};
Su600Config readConfig(Bus& bus);
bool frequencyWord(double hz, const Su600Config& config, uint16_t& result);
bool stopped(uint16_t state, uint16_t outputFrequency);
bool runningForward(uint16_t state);

struct Sample {
  uint16_t raw[6]{}; // fault, state, set frequency, output frequency, current, voltage
  bool ok[6]{};
  uint32_t sampledMs{};
  int64_t sampledUtcMs{};
  bool configOk{}, armed{}, storageOk{};
};
class Controller {
 public:
  Controller(Bus& bus, Storage& storage, Clock& clock, Events& events, bool controls);
  bool begin(const char* uid);
  bool arm(SessionMode mode = SessionMode::Bench);
  void disarm(StopReason reason = StopReason::LocalDisarm);
  void receive(const Command& command, const char* session, const char* ackId, const char* resultId);
  void tick(bool networkConnected);
  Sample sample();
  void replay() const;
  const Journal& journal() const { return journal_; }
  const Su600Config& config() const { return config_; }
  bool isArmed() const { return armed_; }
  SessionMode sessionMode() const { return mode_; }
  StopReason stopReason() const { return stopReason_; }
 private:
  bool save();
  void finish(Record& record, Outcome outcome, Error error = Error::None, double actual = 0);
  void requestStop(StopReason reason);
  bool sessionConfigOk() const;
  Bus& bus_; Storage& storage_; Clock& clock_; Events& events_;
  const bool controls_;
  Journal journal_{};
  Su600Config config_{};
  bool storageOk_{}, armed_{}, stopping_{};
  SessionMode mode_{SessionMode::Bench}; // RAM only: reboot never restores permission.
  StopReason stopReason_{StopReason::None};
  uint32_t runSince_{}, lastStopAttempt_{}, lastConfigRead_{};
  int pending_{-1};
  uint32_t pendingSince_{};
};
} // namespace kerumo
