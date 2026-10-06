#include "core.h"
#include <cctype>
#include <cmath>
#include <cstring>
#include <limits>

namespace kerumo {
const char *stopReasonCode(StopReason reason) {
  static const char *codes[] = {"none",
                                "command",
                                "local_disarm",
                                "bench_timer",
                                "network_lost",
                                "vfd_link_lost",
                                "vfd_fault",
                                "configuration_mismatch",
                                "storage_failed",
                                "physical_result_unconfirmed",
                                "restart_recovery",
                                "program_completed"};
  return codes[static_cast<unsigned>(reason)];
}
const char *errorCode(Error error) {
  static const char *codes[] = {"none",
                                "read_only",
                                "not_armed",
                                "clock_unsynchronized",
                                "expired",
                                "stale_sequence",
                                "configuration_mismatch",
                                "vfd_fault",
                                "frequency_out_of_range",
                                "busy",
                                "storage_failed",
                                "physical_result_unconfirmed",
                                "restart_during_execution",
                                "program_cancelled",
                                "program_transition_timeout",
                                "program_invalid"};
  return codes[static_cast<unsigned>(error)];
}
uint32_t checksum(const Journal &value) {
  const auto *bytes = reinterpret_cast<const uint8_t *>(&value);
  uint32_t crc = 0xFFFFFFFFU;
  for (size_t i = 0; i < sizeof(value); ++i) {
    const uint8_t byte =
        i >= offsetof(Journal, checksum) && i < offsetof(Journal, checksum) + 4 ? 0 : bytes[i];
    crc ^= byte;
    for (unsigned bit = 0; bit < 8; ++bit)
      crc = (crc >> 1) ^ (0xEDB88320U & (0U - (crc & 1U)));
  }
  return ~crc;
}
bool validUuid(const char *s) {
  if (!s || std::strlen(s) != 36)
    return false;
  for (unsigned i = 0; i < 36; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (s[i] != '-')
        return false;
    } else if (!std::isxdigit(static_cast<unsigned char>(s[i])))
      return false;
  }
  return true;
}
bool sameCommand(const Command &a, const Command &b) {
  if (a.program.count != b.program.count)
    return false;
  for (size_t i = 0; i < a.program.count && i < MaxProgramSteps; ++i)
    if (a.program.steps[i].hz != b.program.steps[i].hz ||
        a.program.steps[i].seconds != b.program.steps[i].seconds)
      return false;
  return std::strcmp(a.id, b.id) == 0 && std::strcmp(a.requestId, b.requestId) == 0 &&
         a.sequence == b.sequence && a.issuedMs == b.issuedMs && a.expiresMs == b.expiresMs &&
         a.ttl == b.ttl && a.type == b.type && a.hz == b.hz && a.scheduledStartMs == b.scheduledStartMs &&
         a.scheduledStopMs == b.scheduledStopMs;
}
// Strict UTC RFC3339, accepting Z / +00:00 and up to six fractional digits.
bool parseUtcMs(const char *s, int64_t &result) {
  if (!s || std::strlen(s) < 20 || std::strlen(s) > 32)
    return false;
  if (s[4] != '-' || s[7] != '-' || s[10] != 'T' || s[13] != ':' || s[16] != ':')
    return false;
  auto number = [s](int offset, int count) {
    int n = 0;
    for (int i = 0; i < count; ++i) {
      if (s[offset + i] < '0' || s[offset + i] > '9')
        return -1;
      n = n * 10 + s[offset + i] - '0';
    }
    return n;
  };
  int y = number(0, 4), m = number(5, 2), d = number(8, 2), h = number(11, 2), min = number(14, 2),
      sec = number(17, 2);
  if (y < 2020 || y > 2199 || m < 1 || m > 12 || d < 1 || h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 ||
      sec > 59)
    return false;
  const int days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  const bool leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
  if (d > days[m - 1] + (m == 2 && leap ? 1 : 0))
    return false;
  size_t pos = 19;
  int fraction = 0, digits = 0;
  if (s[pos] == '.') {
    ++pos;
    while (s[pos] >= '0' && s[pos] <= '9') {
      if (digits < 3)
        fraction = fraction * 10 + s[pos] - '0';
      ++digits;
      ++pos;
    }
    if (digits < 1 || digits > 6)
      return false;
    for (int i = digits; i < 3; ++i)
      fraction *= 10;
  }
  if (std::strcmp(s + pos, "Z") != 0 && std::strcmp(s + pos, "+00:00") != 0)
    return false;
  int64_t totalDays = 0;
  for (int year = 1970; year < y; ++year)
    totalDays += 365 + (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
  for (int month = 1; month < m; ++month)
    totalDays += days[month - 1] + (month == 2 && leap ? 1 : 0);
  result = (((totalDays + d - 1) * 24 + h) * 60 + min) * 60000 + sec * 1000 + fraction;
  return true;
}
uint16_t modbusCrc(const uint8_t *bytes, size_t size) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < size; ++i) {
    crc ^= bytes[i];
    for (unsigned b = 0; b < 8; ++b)
      crc = (crc >> 1) ^ ((crc & 1) ? 0xA001 : 0);
  }
  return crc;
}
bool readResponse(const uint8_t *bytes, size_t size, uint8_t slave, uint16_t &value) {
  if (size != 7 || bytes[0] != slave || bytes[1] != 3 || bytes[2] != 2 || modbusCrc(bytes, size) != 0)
    return false;
  value = static_cast<uint16_t>((bytes[3] << 8) | bytes[4]);
  return true;
}
bool writeResponse(const uint8_t *bytes, size_t size, const uint8_t request[8]) {
  return size == 8 && std::memcmp(bytes, request, 8) == 0 && modbusCrc(bytes, size) == 0;
}

Controller::Controller(VfdDriver &driver, Storage &storage, Clock &clock, Events &events, bool controls)
    : driver_(driver), storage_(storage), clock_(clock), events_(events), controls_(controls) {}
bool Controller::save() {
  journal_.checksum = checksum(journal_);
  storageOk_ = storage_.save(journal_);
  if (!storageOk_)
    disarm(StopReason::Storage);
  return storageOk_;
}
static void clearJournal(Journal &target) {
  // Avoid repeated large aggregate temporaries: Xtensa GCC 14 ICEs while lowering them.
  static const Journal empty{};
  target = empty;
}
bool Controller::begin(const char *uid) {
  if (!uid || std::strlen(uid) > 96)
    return false;
  const int loaded = storage_.load(journal_);
  if (loaded < 0) {
    clearJournal(journal_);
    return false;
  }
  if (loaded == 0) {
    clearJournal(journal_);
    std::strncpy(journal_.uid, uid, 96);
    if (!save())
      return false;
  } else if (journal_.magic != 0x4B563303 || journal_.checksum != checksum(journal_) ||
             journal_.next >= LedgerSize || std::strncmp(journal_.uid, uid, sizeof(journal_.uid)) != 0 ||
             journal_.highest > MaxSequence) {
    clearJournal(journal_);
    return false;
  }
  storageOk_ = true;
  for (auto &record : journal_.records)
    if (record.outcome == Outcome::Pending) {
      if (programType(record.command.type)) {
        if (programSlot_ >= 0 ||
            !validProgram(record.command.program,
                          record.command.type == Type::Schedule ? MaxScheduleSeconds : MaxProgramSeconds))
          return false;
        programSlot_ = static_cast<int>(&record - journal_.records);
        journal_.motionPossible = true; // Відновлення незавершеної програми вимагає підтвердження STOP.
        std::strncpy(program_.commandId, record.command.id, 36);
        program_.phase = ProgramPhase::Stopping;
        program_.count = record.command.program.count;
        program_.step = record.stepsCompleted;
        programReason_ = StopReason::Restart;
        programError_ = Error::Restarted;
        programPhaseSince_ = clock_.uptimeMs();
      } else {
        record.outcome = Outcome::Unknown;
        record.error = Error::Restarted;
      }
    }
  if (!save())
    return false;
  driver_.refreshConfig();
  lastConfigRead_ = clock_.monotonicMs();
  // No blanket boot write: a persisted run intent is stopped only in the verified profile.
  stopping_ = controls_ && journal_.motionPossible;
  if (stopping_) {
    stopReason_ = StopReason::Restart;
    recordStop(StopReason::Restart);
  }
  return true;
}
bool Controller::sessionConfigOk() const {
  return mode_ == SessionMode::ExtendedTest ? driver_.extendedTestOk() : driver_.controlOk();
}
bool Controller::arm(SessionMode mode) {
  // A repeated ARM during motion must not change the session or the timer.
  if (journal_.motionPossible || pending_ >= 0 || programSlot_ >= 0 || stopping_)
    return false;
  armed_ = false;
  mode_ = SessionMode::Bench;
  if (!controls_ || !storageOk_ || !clock_.utcMs())
    return false;
  driver_.refreshConfig();
  lastConfigRead_ = clock_.monotonicMs();
  DriveState state{};
  double output{};
  uint16_t fault{};
  armed_ = (mode == SessionMode::ExtendedTest ? driver_.extendedTestOk() : driver_.controlOk()) &&
           driver_.readState(state) && driver_.readOutputHz(output) && driver_.readFault(fault) &&
           fault == 0 && confirmedStopped(state, output);
  armed_ = armed_ && clock_.utcMs();
  if (armed_) {
    mode_ = mode;
    remoteInhibited_ = false; // An explicit successful ARM releases local DISARM.
    remotePermissionUtcMs_ = 0;
  }
  return armed_;
}
void Controller::recordStop(StopReason reason) {
  lastStop_ = {reason, clock_.uptimeMs(), clock_.utcMs(), false};
}
void Controller::requestStop(StopReason reason) {
  // Повтори STOP і пізніші блокування не переписують початкову причину й час.
  if (!stopping_)
    recordStop(reason);
  if (programSlot_ >= 0) {
    if (program_.phase != ProgramPhase::Stopping)
      programPhaseSince_ = clock_.uptimeMs();
    program_.phase = ProgramPhase::Stopping;
    program_.remainingSeconds = 0;
    if (programReason_ == StopReason::None || programReason_ == StopReason::ProgramCompleted)
      programReason_ = reason;
    if (programError_ == Error::None && reason != StopReason::ProgramCompleted)
      programError_ = reason == StopReason::Command || reason == StopReason::LocalDisarm
                          ? Error::ProgramCancelled
                      : reason == StopReason::Fault   ? Error::Fault
                      : reason == StopReason::Config  ? Error::Config
                      : reason == StopReason::Storage ? Error::Storage
                                                      : Error::Unconfirmed;
  }
  // Штатний STOP і завершення програми зберігають місцевий допуск extended.
  if ((reason != StopReason::Command && reason != StopReason::ProgramCompleted) ||
      mode_ != SessionMode::ExtendedTest) {
    armed_ = false;
    mode_ = SessionMode::Bench;
  }
  if (!stopping_ || reason == StopReason::LocalDisarm ||
      (stopReason_ == StopReason::Command && reason != StopReason::Command))
    stopReason_ = reason;
  stopping_ = true;
}
void Controller::disarm(StopReason reason) {
  if (reason == StopReason::LocalDisarm)
    remoteInhibited_ = true;
  armed_ = false;
  mode_ = SessionMode::Bench;
  if (journal_.motionPossible)
    requestStop(reason);
  else
    stopReason_ = reason;
}
void Controller::finish(Record &record, Outcome outcome, Error error, double actual) {
  record.outcome = outcome;
  record.error = error;
  record.actualHz = actual;
  record.completedMs = clock_.utcMs();
  if (save())
    events_.emit(record);
  if (pending_ >= 0 && &record == &journal_.records[pending_])
    pending_ = -1;
}
void Controller::receive(const Command &c, const char *session, const char *ackId, const char *resultId) {
  if (!storageOk_)
    return;
  for (const auto &record : journal_.records)
    if (record.outcome != Outcome::Empty && std::strcmp(c.id, record.command.id) == 0) {
      if (sameCommand(c, record.command))
        events_.emit(record);
      return; // conflicting ID never changes the saved response or performs I/O
    }
  Record incoming{};
  incoming.command = c;
  std::strncpy(incoming.session, session, 36);
  std::strncpy(incoming.ackId, ackId, 36);
  std::strncpy(incoming.resultId, resultId, 36);
  const int64_t now = clock_.utcMs();
  incoming.acceptedMs = now;
  Error rejection = Error::None;
  if (!now)
    rejection = Error::Clock;
  else if (c.issuedMs > now + 2000 || c.expiresMs <= now)
    rejection = Error::Expired;
  else if (c.sequence <= journal_.highest || c.sequence > MaxSequence)
    rejection = Error::Stale;
  if (rejection != Error::None) {
    incoming.outcome = Outcome::Failed;
    incoming.error = rejection;
    incoming.completedMs = now;
    events_.emit(incoming);
    return;
  }
  // A newer Stop must displace pending verification, never wait behind it.
  if (pending_ >= 0 && c.type == Type::Stop) {
    auto &previous = journal_.records[pending_];
    finish(previous, Outcome::Unknown, Error::Unconfirmed);
    if (!storageOk_)
      return;
  }
  if (pending_ >= 0 || (programSlot_ >= 0 && c.type != Type::Stop)) {
    incoming.outcome = Outcome::Failed;
    incoming.error = Error::Busy;
    incoming.completedMs = now;
  } else if (!controls_) {
    incoming.outcome = Outcome::Failed;
    incoming.error = Error::ReadOnly;
    incoming.completedMs = now;
  } else if (c.type != Type::Stop &&
             (!armed_ || (remotePermissionUtcMs_ && c.issuedMs < remotePermissionUtcMs_))) {
    incoming.outcome = Outcome::Failed;
    incoming.error = Error::NotArmed;
    incoming.completedMs = now;
  } else
    incoming.outcome = Outcome::Pending;
  // Never overwrite the one active record if the bounded history wraps.
  size_t slot = journal_.next;
  while (static_cast<int>(slot) == pending_ || static_cast<int>(slot) == programSlot_)
    slot = (slot + 1) % LedgerSize;
  journal_.next = (slot + 1) % LedgerSize;
  journal_.highest = c.sequence;
  journal_.records[slot] = incoming;
  if (!save())
    return;
  auto &record = journal_.records[slot];
  events_.emit(record);
  if (record.outcome != Outcome::Pending)
    return;
  driver_.refreshConfig();
  lastConfigRead_ = clock_.monotonicMs();
  if (!(c.type == Type::Stop ? driver_.profileOk() : sessionConfigOk())) {
    finish(record, Outcome::Failed, Error::Config);
    disarm(StopReason::Config);
    return;
  }
  // Configuration reads take time; expiry is checked again immediately before actuation.
  if (!clock_.utcMs() || clock_.utcMs() >= c.expiresMs) {
    finish(record, Outcome::Failed, Error::Expired);
    return;
  }
  uint16_t fault{};
  if (c.type != Type::Stop && (!driver_.readFault(fault) || fault != 0)) {
    finish(record, Outcome::Failed, Error::Fault);
    disarm(StopReason::Fault);
    return;
  }
  if (c.type == Type::Frequency && !driver_.frequencyAllowed(c.hz)) {
    finish(record, Outcome::Failed, Error::Frequency);
    return;
  }
  if (programType(c.type)) {
    if (mode_ != SessionMode::ExtendedTest ||
        !validProgram(c.program, c.type == Type::Schedule ? MaxScheduleSeconds : MaxProgramSeconds)) {
      finish(record, Outcome::Failed, Error::ProgramInvalid);
      return;
    }
    for (size_t i = 0; i < c.program.count; ++i)
      if (!driver_.frequencyAllowed(c.program.steps[i].hz)) {
        finish(record, Outcome::Failed, Error::Frequency);
        return;
      }
    DriveState state{};
    double output{};
    if (journal_.motionPossible || stopping_ || !driver_.readState(state) || !driver_.readOutputHz(output) ||
        !confirmedStopped(state, output)) {
      finish(record, Outcome::Failed, Error::Busy);
      return;
    }
    if (!clock_.utcMs() || clock_.utcMs() >= c.expiresMs) {
      finish(record, Outcome::Failed, Error::Expired);
      return;
    }
    if (c.type == Type::Schedule) {
      const int64_t utc = clock_.utcMs();
      int64_t duration = 0;
      for (size_t i = 0; i < c.program.count; ++i)
        duration += c.program.steps[i].seconds * 1000LL;
      if (c.scheduledStopMs - c.scheduledStartMs != duration || utc < c.scheduledStartMs ||
          utc >= c.scheduledStartMs + 30000 || utc >= c.scheduledStopMs ||
          utc >= c.scheduledStartMs + c.program.steps[0].seconds * 1000LL) {
        finish(record, Outcome::Failed, Error::Expired);
        return;
      }
      calendarStopAt_ = clock_.uptimeMs() + static_cast<uint64_t>(c.scheduledStopMs - utc);
    }
    programSlot_ = static_cast<int>(slot);
    program_ = {};
    program_.count = c.program.count;
    std::strncpy(program_.commandId, c.id, 36);
    programReason_ = StopReason::None;
    programError_ = Error::None;
    journal_.motionPossible = true;
    stopReason_ = StopReason::None;
    if (!save())
      return; // Зберігаємо до першого запису частоти у VFD.
    beginProgramStep();
    return;
  }
  if (c.type == Type::Start) {
    DriveState state{};
    double setpoint{};
    if (journal_.motionPossible || !driver_.readState(state) || !driver_.readSetHz(setpoint) ||
        !state.stopped || setpoint == 0 || !driver_.frequencyAllowed(setpoint)) {
      finish(record, Outcome::Failed, Error::Frequency);
      return;
    }
    if (!clock_.utcMs() || clock_.utcMs() >= c.expiresMs) {
      finish(record, Outcome::Failed, Error::Expired);
      return;
    }
    journal_.motionPossible = true;
    runSince_ = clock_.monotonicMs();
    stopReason_ = StopReason::None;
  }
  if (c.type == Type::Stop) {
    journal_.motionPossible = true;
    requestStop(StopReason::Command);
  }
  // Persist possible physical execution BEFORE the write, including a lost echo/crash window.
  if (!save())
    return;
  if (!clock_.utcMs() || clock_.utcMs() >= c.expiresMs) {
    finish(record, Outcome::Failed, Error::Expired);
    if (journal_.motionPossible)
      requestStop(StopReason::Unconfirmed);
    return;
  }
  pending_ = static_cast<int>(slot);
  pendingSince_ = clock_.monotonicMs();
  if (c.type == Type::Frequency)
    driver_.setFrequency(c.hz);
  else if (c.type == Type::Start)
    driver_.startForward();
  else
    driver_.stop();
  // FC06 echo is not a physical success. tick() verifies the actual register state.
}
void Controller::beginProgramStep() {
  auto &record = journal_.records[programSlot_];
  const auto &step = record.command.program.steps[record.stepsCompleted];
  driver_.refreshConfig();
  lastConfigRead_ = clock_.monotonicMs();
  if (!sessionConfigOk()) {
    requestStop(StopReason::Config);
    return;
  }
  if (record.command.type == Type::Schedule && clock_.uptimeMs() >= calendarStepEnd()) {
    programError_ = Error::ProgramTimeout;
    requestStop(StopReason::Unconfirmed);
    return;
  }
  if (!driver_.frequencyAllowed(step.hz)) {
    requestStop(StopReason::Config);
    return;
  }
  program_.step = record.stepsCompleted + 1;
  program_.targetHz = step.hz;
  program_.remainingSeconds = step.seconds;
  program_.phase = ProgramPhase::Setting;
  programPhaseSince_ = clock_.uptimeMs();
  lastProgramPoll_ = 0;
  driver_.setFrequency(step.hz);
}
uint64_t Controller::calendarStepEnd() const {
  const auto &record = journal_.records[programSlot_];
  uint64_t remaining = 0;
  for (size_t i = record.stepsCompleted + 1; i < record.command.program.count; ++i)
    remaining += record.command.program.steps[i].seconds * 1000ULL;
  return calendarStopAt_ >= remaining ? calendarStopAt_ - remaining : 0;
}
void Controller::completeProgram(bool stopConfirmed) {
  if (programSlot_ < 0)
    return;
  auto &record = journal_.records[programSlot_];
  const bool success =
      stopConfirmed && programReason_ == StopReason::ProgramCompleted && programError_ == Error::None;
  program_.phase = success ? ProgramPhase::Completed
                   : programError_ == Error::ProgramCancelled || programError_ == Error::Restarted
                       ? ProgramPhase::Interrupted
                       : ProgramPhase::Failed;
  program_.remainingSeconds = 0;
  if (!stopConfirmed)
    programError_ = Error::Unconfirmed;
  record.programStopConfirmed = stopConfirmed;
  programSlot_ = -1; // Збій збереження фіналу не повинен повторно скасувати цю програму.
  if (!stopConfirmed)
    disarm(StopReason::Unconfirmed);
  finish(record, stopConfirmed ? (success ? Outcome::Succeeded : Outcome::Failed) : Outcome::Unknown,
         programError_, 0);
}
void Controller::tickProgram() {
  if (programSlot_ < 0)
    return;
  const uint64_t now = clock_.uptimeMs();
  if (program_.phase == ProgramPhase::Stopping) {
    if (now - programPhaseSince_ >= ProgramTransitionMs)
      completeProgram(false);
    return;
  }
  if (now - lastProgramPoll_ < 250)
    return;
  lastProgramPoll_ = now;
  auto &record = journal_.records[programSlot_];
  const bool calendar = record.command.type == Type::Schedule;
  if (calendar && now >= calendarStepEnd()) {
    if (program_.phase != ProgramPhase::Holding) {
      programError_ = Error::ProgramTimeout;
      requestStop(StopReason::Unconfirmed);
      return;
    }
    ++record.stepsCompleted;
    if (!save())
      return;
    if (record.stepsCompleted == record.command.program.count)
      requestStop(StopReason::ProgramCompleted);
    else
      beginProgramStep();
    return;
  }
  const auto &step = record.command.program.steps[record.stepsCompleted];
  DriveState state{};
  double output{}, setpoint{};
  uint16_t fault{};
  if (!driver_.readFault(fault) || !driver_.readState(state) || !driver_.readSetHz(setpoint) ||
      !driver_.readOutputHz(output)) {
    requestStop(StopReason::Link);
    return;
  }
  if (fault) {
    requestStop(StopReason::Fault);
    return;
  }
  const bool target = std::fabs(output - step.hz) <= 0.11;
  if (program_.phase == ProgramPhase::Holding) {
    if (!state.forward || !target || std::fabs(setpoint - step.hz) > 0.11) {
      requestStop(StopReason::Unconfirmed);
      return;
    }
    const uint64_t elapsed = clock_.uptimeMs() - programHoldSince_;
    program_.remainingSeconds =
        calendar ? (calendarStepEnd() > clock_.uptimeMs()
                        ? static_cast<uint32_t>((calendarStepEnd() - clock_.uptimeMs() + 999) / 1000)
                        : 0)
        : elapsed >= step.seconds * 1000ULL
            ? 0
            : static_cast<uint32_t>((step.seconds * 1000ULL - elapsed + 999) / 1000);
    if (program_.remainingSeconds == 0) {
      ++record.stepsCompleted;
      if (!save())
        return; // Flash записується на межі етапів, а не щосекунди.
      if (record.stepsCompleted == record.command.program.count)
        requestStop(StopReason::ProgramCompleted);
      else
        beginProgramStep();
    }
    return;
  }
  if (clock_.uptimeMs() - programPhaseSince_ >= ProgramTransitionMs) {
    programError_ = Error::ProgramTimeout;
    requestStop(StopReason::Unconfirmed);
    return;
  }
  if (std::fabs(setpoint - step.hz) > 0.11)
    return;
  if (program_.phase == ProgramPhase::Setting && record.stepsCompleted == 0) {
    if (!confirmedStopped(state, output)) {
      requestStop(StopReason::Unconfirmed);
      return;
    }
    if (!clock_.utcMs() || clock_.utcMs() >= record.command.expiresMs ||
        (calendar && (clock_.utcMs() < record.command.scheduledStartMs ||
                      clock_.utcMs() >= record.command.scheduledStartMs + 30000 ||
                      clock_.uptimeMs() >= calendarStepEnd()))) {
      programError_ = Error::Expired;
      requestStop(StopReason::Unconfirmed);
      return;
    }
    program_.phase = ProgramPhase::Starting;
    driver_.startForward(); // Один RUN; втрату echo перевіряємо читанням, без повторного запуску.
    return;
  }
  if (state.forward && target) {
    program_.phase = ProgramPhase::Holding;
    programHoldSince_ = clock_.uptimeMs();
  }
}
void Controller::tick(bool networkConnected, bool remoteOperation) {
  const uint32_t now = clock_.monotonicMs();
  if (!networkConnected && (armed_ || journal_.motionPossible))
    disarm(StopReason::Network);
  if (journal_.motionPossible && !stopping_ && mode_ == SessionMode::Bench &&
      static_cast<uint32_t>(now - runSince_) >= AutoStopMs)
    requestStop(StopReason::BenchTimer);
  if (stopping_ && controls_ && static_cast<uint32_t>(now - lastStopAttempt_) >= 1000) {
    lastStopAttempt_ = now;
    // UART may have been unavailable during boot with a persisted RUN intent.
    if (!driver_.profileOk()) {
      driver_.refreshConfig();
      lastConfigRead_ = clock_.monotonicMs();
    }
    // Recheck protocol before recovery writes. This is NOT automatic hardware identification.
    if (driver_.recoveryAllowed()) {
      driver_.stop();
      DriveState state{};
      double output{};
      if (driver_.readState(state) && driver_.readOutputHz(output) && confirmedStopped(state, output)) {
        journal_.motionPossible = false;
        stopping_ = false;
        lastStop_.confirmed = true;
        save();
        if (programSlot_ >= 0)
          completeProgram(true);
      }
    }
  }
  if (pending_ >= 0 && storageOk_) {
    auto &record = journal_.records[pending_];
    const Type type = record.command.type;
    DriveState state{};
    double output{};
    uint16_t fault{};
    bool verified = false;
    double actual = 0;
    if (type == Type::Frequency) {
      verified = driver_.readSetHz(output) && std::fabs(output - record.command.hz) <= 0.11;
      actual = output;
    } else if (driver_.readState(state) && driver_.readOutputHz(output) && driver_.readFault(fault)) {
      verified =
          type == Type::Stop ? confirmedStopped(state, output) : state.forward && fault == 0 && !stopping_;
      actual = output;
    }
    if (verified) {
      if (type == Type::Stop) {
        journal_.motionPossible = false;
        stopping_ = false;
        lastStop_.confirmed = true;
      }
      finish(record, Outcome::Succeeded, Error::None, actual);
      if (type == Type::Stop && programSlot_ >= 0)
        completeProgram(true);
    } else if (static_cast<uint32_t>(now - pendingSince_) >= 10000) {
      finish(record, Outcome::Unknown, Error::Unconfirmed);
      requestStop(StopReason::Unconfirmed);
    }
  }
  tickProgram();
  if ((!journal_.motionPossible || mode_ == SessionMode::ExtendedTest) && pending_ < 0 &&
      static_cast<uint32_t>(now - lastConfigRead_) >= 10000) {
    driver_.refreshConfig();
    lastConfigRead_ = clock_.monotonicMs();
    if (!sessionConfigOk())
      disarm(StopReason::Config);
  }
  // The option persists in firmware, never as a saved RUN/ARM latch. Reconnect
  // and boot must first finish recovery STOP. Idle readback must confirm STOP,
  // zero output, fault-free extended profile, valid clock and durable journal.
  // Local DISARM blocks automatic permission until explicit ARM or reboot.
  if (remoteOperation && networkConnected && !remoteInhibited_ && !armed_ && controls_ &&
      storageOk_ && clock_.utcMs() && !journal_.motionPossible && !stopping_ &&
      pending_ < 0 && programSlot_ < 0 &&
      (!remoteCheckStarted_ || static_cast<uint32_t>(clock_.monotonicMs() - lastRemoteCheck_) >= 3000)) {
    remoteCheckStarted_ = true;
    lastRemoteCheck_ = clock_.monotonicMs();
    if (arm(SessionMode::ExtendedTest))
      remotePermissionUtcMs_ = clock_.utcMs();
  }
}
Sample Controller::sample() {
  Sample sample{};
  sample.vfd = driver_.sample();
  if (journal_.motionPossible && (!sample.vfd.ok[0] || !sample.vfd.ok[1] || !sample.vfd.ok[3]))
    requestStop(StopReason::Link);
  else if (journal_.motionPossible && sample.vfd.fault != 0)
    requestStop(StopReason::Fault);
  sample.sampledMs = clock_.monotonicMs();
  sample.sampledUtcMs = clock_.utcMs();
  sample.configOk = sessionConfigOk();
  sample.armed = armed_;
  sample.storageOk = storageOk_;
  sample.commandSequence = journal_.highest;
  sample.uptimeMs = clock_.uptimeMs();
  sample.lastStop = lastStop_;
  sample.program = program_;
  sample.program.ready = controls_ && storageOk_ && armed_ && mode_ == SessionMode::ExtendedTest;
  sample.programReason = programReason_;
  return sample;
}
void Controller::replay() const {
  if (storageOk_)
    for (const auto &record : journal_.records)
      if (record.outcome != Outcome::Empty)
        events_.emit(record);
}
} // namespace kerumo
