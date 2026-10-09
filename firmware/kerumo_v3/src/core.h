#pragma once
#include <cstddef>
#include <cstdint>
#include "program.h"
#include "vfd_driver.h"

namespace kerumo {
constexpr size_t LedgerSize = 8;
constexpr uint64_t MaxSequence = 9007199254740991ULL;
constexpr uint32_t AutoStopMs = 60000;
enum class SessionMode : uint8_t { Bench, ExtendedTest };
enum class StopReason : uint8_t { None, Command, LocalDisarm, BenchTimer, Network, Link, Fault, Config, Storage, Unconfirmed, Restart, ProgramCompleted };
const char* stopReasonCode(StopReason reason);
enum class Type : uint8_t { Start, Stop, Frequency, Program, Schedule, Source, Parameter };
inline bool settingsType(Type type) { return type == Type::Source || type == Type::Parameter; }
inline bool programType(Type type) { return type==Type::Program || type==Type::Schedule; }
enum class Outcome : uint8_t { Empty, Pending, Succeeded, Failed, Unknown };
enum class Error : uint8_t {
  None, ReadOnly, NotArmed, Clock, Expired, Stale, Config, Fault,
  Frequency, Busy, Storage, Unconfirmed, Restarted, ProgramCancelled, ProgramTimeout, ProgramInvalid,
  SettingChanged, SettingInvalid
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
  ProgramPlan program{};
  int64_t scheduledStartMs{}, scheduledStopMs{};
  SettingRequest setting{};
};
struct Record {
  Command command{};
  char ackId[37]{}, resultId[37]{}, session[37]{};
  int64_t acceptedMs{}, completedMs{};
  Outcome outcome{Outcome::Empty};
  Error error{Error::None};
  double actualHz{};
  uint8_t stepsCompleted{};
  bool programStopConfirmed{};
  SettingResult settingResult{};
};
// One committed NVS blob contains the sequence, intent, responses and run latch.
struct Journal {
  uint32_t magic{0x4B563305};
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

struct Storage {
  virtual ~Storage() = default;
  // 0 = new namespace, 1 = loaded, -1 = corrupt/unavailable. Never erase to recover.
  virtual int load(Journal& value) = 0;
  virtual bool save(const Journal& value) = 0;
};
struct Clock {
  virtual ~Clock() = default;
  virtual uint32_t monotonicMs() const = 0;
  virtual uint64_t uptimeMs() const = 0; // діагностика переживає переповнення 32-бітного millis()
  virtual int64_t utcMs() const = 0; // zero if UTC has not been synchronized recently
  virtual bool controlLinkValid() const { return true; }
};
struct Events {
  virtual ~Events() = default;
  virtual void emit(const Record& record) = 0;
};
struct StopDiagnostic {
  StopReason reason{StopReason::None};
  uint64_t uptimeMs{};
  int64_t requestedUtcMs{}; // нуль: UTC був недоступний у момент запиту STOP
  bool confirmed{}; // стан VFD + 0 Гц, не незалежне вимірювання обертання вала
};
struct Sample {
  DriveSample vfd{};
  uint32_t sampledMs{};
  int64_t sampledUtcMs{};
  bool configOk{}, armed{}, storageOk{};
  uint64_t commandSequence{};
  uint64_t uptimeMs{};
  StopDiagnostic lastStop{};
  ProgramProgress program{};
  StopReason programReason{StopReason::None};
  DriveSettings settings{};
  bool settingsReady{}, bindingCompatible{};
};
class Controller {
 public:
  Controller(VfdDriver& driver, Storage& storage, Clock& clock, Events& events, bool controls);
  bool begin(const char* uid);
  bool arm(SessionMode mode = SessionMode::Bench);
  void disarm(StopReason reason = StopReason::LocalDisarm);
  void receive(const Command& command, const char* session, const char* ackId, const char* resultId);
  // Explicit firmware opt-in, supplied only for a locally confirmed installation.
  // Grants permission after checks; never starts or resumes motion.
  void tick(bool networkConnected, bool remoteOperation = false);
  Sample sample();
  void replay() const;
  const Journal& journal() const { return journal_; }
  bool isArmed() const { return armed_; }
  SessionMode sessionMode() const { return mode_; }
  StopReason stopReason() const { return stopReason_; }
 private:
  bool save();
  void finish(Record& record, Outcome outcome, Error error = Error::None, double actual = 0);
  void requestStop(StopReason reason);
  void recordStop(StopReason reason);
  bool sessionConfigOk() const;
  void beginProgramStep();
  void tickProgram();
  void completeProgram(bool stopConfirmed);
  bool settingsStopped();
  void executeSetting(Record& record);
  VfdDriver& driver_; Storage& storage_; Clock& clock_; Events& events_;
  const bool controls_;
  Journal journal_{};
  bool storageOk_{}, armed_{}, stopping_{};
  bool remoteInhibited_{}, remoteCheckStarted_{};
  bool remoteOperation_{}, networkConnected_{};
  uint32_t lastRemoteCheck_{};
  int64_t remotePermissionUtcMs_{}; // Reject commands issued before automatic permission.
  SessionMode mode_{SessionMode::Bench}; // RAM only; remote mode revalidates after reboot.
  StopReason stopReason_{StopReason::None};
  StopDiagnostic lastStop_{}; // лише поточний boot; сама STOP-діагностика не записується в NVS
  uint32_t runSince_{}, lastStopAttempt_{}, lastConfigRead_{};
  int pending_{-1};
  uint32_t pendingSince_{};
  int programSlot_{-1};
  ProgramProgress program_{};
  StopReason programReason_{StopReason::None};
  Error programError_{Error::None};
  uint64_t programPhaseSince_{}, programHoldSince_{}, lastProgramPoll_{};
  uint64_t calendarStopAt_{};
  uint64_t calendarStepEnd() const;
};
} // namespace kerumo
