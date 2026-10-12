#pragma once
#include "core.h"
#include <cstring>

namespace kerumo {
// Точний NVS layout v0.1/v0.2. Невідповідність не дозволяє скинути sequence чи стерти журнал.
struct LegacyCommand {
  char id[37]{}; char requestId[37]{}; uint64_t sequence{};
  int64_t issuedMs{}, expiresMs{}; uint16_t ttl{}; Type type{}; double hz{};
};
struct LegacyRecord {
  LegacyCommand command{}; char ackId[37]{}, resultId[37]{}, session[37]{};
  int64_t acceptedMs{}, completedMs{}; Outcome outcome{Outcome::Empty};
  Error error{Error::None}; double actualHz{};
};
struct LegacyJournal {
  uint32_t magic{0x4B563301}, checksum{}; char uid[97]{}; uint64_t highest{};
  uint8_t next{}; bool motionPossible{}; LegacyRecord records[LedgerSize]{};
};
// Точний layout v0.3 із етапами, до додавання календарних UTC-меж.
struct ProgramCommandV3 {
  char id[37]{}; char requestId[37]{}; uint64_t sequence{};
  int64_t issuedMs{}, expiresMs{}; uint16_t ttl{}; Type type{}; double hz{}; ProgramPlan program{};
};
struct ProgramRecordV3 {
  ProgramCommandV3 command{}; char ackId[37]{}, resultId[37]{}, session[37]{};
  int64_t acceptedMs{}, completedMs{}; Outcome outcome{Outcome::Empty};
  Error error{Error::None}; double actualHz{}; uint8_t stepsCompleted{}; bool programStopConfirmed{};
};
struct ProgramJournalV3 {
  uint32_t magic{0x4B563302}, checksum{}; char uid[97]{}; uint64_t highest{};
  uint8_t next{}; bool motionPossible{}; ProgramRecordV3 records[LedgerSize]{};
};
// Exact v0.5–0.9.1 calendar layout. Keep old EEPROM bytes and sequence.
struct CalendarCommandV5 {
  char id[37]{}; char requestId[37]{}; uint64_t sequence{};
  int64_t issuedMs{}, expiresMs{}; uint16_t ttl{}; Type type{}; double hz{};
  ProgramPlan program{}; int64_t scheduledStartMs{}, scheduledStopMs{};
};
struct CalendarRecordV5 {
  CalendarCommandV5 command{}; char ackId[37]{}, resultId[37]{}, session[37]{};
  int64_t acceptedMs{}, completedMs{}; Outcome outcome{Outcome::Empty};
  Error error{Error::None}; double actualHz{}; uint8_t stepsCompleted{}; bool programStopConfirmed{};
};
struct CalendarJournalV5 {
  uint32_t magic{0x4B563303}, checksum{}; char uid[97]{}; uint64_t highest{};
  uint8_t next{}; bool motionPossible{}; CalendarRecordV5 records[LedgerSize]{};
};
template<class T> inline uint32_t legacyChecksum(const T& value) {
  const auto* bytes=reinterpret_cast<const uint8_t*>(&value); uint32_t crc=0xFFFFFFFFU;
  for (size_t i=0;i<sizeof(value);++i) {
    crc^=i>=offsetof(T,checksum) && i<offsetof(T,checksum)+4?0:bytes[i];
    for(unsigned bit=0;bit<8;++bit) crc=(crc>>1)^(0xEDB88320U&(0U-(crc&1U)));
  }
  return ~crc;
}
inline void resetUpgradeTarget(Journal& next) {
  // Один іменований шаблон: без великого stack temporary та ICE Xtensa GCC
  // на повторному присвоєнні Journal{} у двох overload міграції.
  static const Journal empty{};
  next=empty;
}
inline bool upgradeJournal(const CalendarJournalV5& old,Journal& next) {
  if (old.magic!=0x4B563303 || old.checksum!=legacyChecksum(old) || old.next>=LedgerSize ||
      old.highest>MaxSequence || !std::memchr(old.uid,0,sizeof(old.uid))) return false;
  resetUpgradeTarget(next); std::memcpy(next.uid,old.uid,sizeof(old.uid));
  next.highest=old.highest; next.next=old.next; next.motionPossible=old.motionPossible;
  for(size_t i=0;i<LedgerSize;++i) {
    const auto& a=old.records[i]; auto& b=next.records[i];
    if (static_cast<unsigned>(a.command.type)>static_cast<unsigned>(Type::Schedule) ||
        !std::memchr(a.command.id,0,37) || !std::memchr(a.command.requestId,0,37)) return false;
    std::memcpy(b.command.id,a.command.id,37); std::memcpy(b.command.requestId,a.command.requestId,37);
    b.command.sequence=a.command.sequence; b.command.issuedMs=a.command.issuedMs;
    b.command.expiresMs=a.command.expiresMs; b.command.ttl=a.command.ttl;
    b.command.type=a.command.type; b.command.hz=a.command.hz; b.command.program=a.command.program;
    b.command.scheduledStartMs=a.command.scheduledStartMs; b.command.scheduledStopMs=a.command.scheduledStopMs;
    std::memcpy(b.ackId,a.ackId,37); std::memcpy(b.resultId,a.resultId,37); std::memcpy(b.session,a.session,37);
    b.acceptedMs=a.acceptedMs; b.completedMs=a.completedMs; b.outcome=a.outcome; b.error=a.error; b.actualHz=a.actualHz;
    b.stepsCompleted=a.stepsCompleted; b.programStopConfirmed=a.programStopConfirmed;
  }
  next.checksum=checksum(next); return true;
}
inline bool upgradeJournal(const ProgramJournalV3& old,Journal& next) {
  if (old.magic!=0x4B563302 || old.checksum!=legacyChecksum(old) || old.next>=LedgerSize ||
      old.highest>MaxSequence || !std::memchr(old.uid,0,sizeof(old.uid))) return false;
  resetUpgradeTarget(next); std::memcpy(next.uid,old.uid,sizeof(old.uid));
  next.highest=old.highest; next.next=old.next; next.motionPossible=old.motionPossible;
  for(size_t i=0;i<LedgerSize;++i) {
    const auto& a=old.records[i]; auto& b=next.records[i];
    if (static_cast<unsigned>(a.command.type)>static_cast<unsigned>(Type::Program) ||
        !std::memchr(a.command.id,0,37) || !std::memchr(a.command.requestId,0,37)) return false;
    std::memcpy(b.command.id,a.command.id,37); std::memcpy(b.command.requestId,a.command.requestId,37);
    b.command.sequence=a.command.sequence; b.command.issuedMs=a.command.issuedMs;
    b.command.expiresMs=a.command.expiresMs; b.command.ttl=a.command.ttl;
    b.command.type=a.command.type; b.command.hz=a.command.hz; b.command.program=a.command.program;
    std::memcpy(b.ackId,a.ackId,37); std::memcpy(b.resultId,a.resultId,37); std::memcpy(b.session,a.session,37);
    b.acceptedMs=a.acceptedMs; b.completedMs=a.completedMs; b.outcome=a.outcome; b.error=a.error; b.actualHz=a.actualHz;
    b.stepsCompleted=a.stepsCompleted; b.programStopConfirmed=a.programStopConfirmed;
  }
  next.checksum=checksum(next); return true;
}
inline bool upgradeJournal(const LegacyJournal& old,Journal& next) {
  if (old.magic!=0x4B563301 || old.checksum!=legacyChecksum(old) || old.next>=LedgerSize ||
      old.highest>MaxSequence || !std::memchr(old.uid,0,sizeof(old.uid))) return false;
  resetUpgradeTarget(next); std::memcpy(next.uid,old.uid,sizeof(old.uid));
  next.highest=old.highest; next.next=old.next; next.motionPossible=old.motionPossible;
  for(size_t i=0;i<LedgerSize;++i) {
    const auto& a=old.records[i]; auto& b=next.records[i];
    if (static_cast<unsigned>(a.command.type)>static_cast<unsigned>(Type::Frequency) ||
        !std::memchr(a.command.id,0,sizeof(a.command.id)) || !std::memchr(a.command.requestId,0,sizeof(a.command.requestId))) return false;
    std::memcpy(b.command.id,a.command.id,37); std::memcpy(b.command.requestId,a.command.requestId,37);
    b.command.sequence=a.command.sequence; b.command.issuedMs=a.command.issuedMs;
    b.command.expiresMs=a.command.expiresMs; b.command.ttl=a.command.ttl;
    b.command.type=a.command.type; b.command.hz=a.command.hz;
    std::memcpy(b.ackId,a.ackId,37); std::memcpy(b.resultId,a.resultId,37); std::memcpy(b.session,a.session,37);
    b.acceptedMs=a.acceptedMs; b.completedMs=a.completedMs; b.outcome=a.outcome; b.error=a.error; b.actualHz=a.actualHz;
  }
  next.checksum=checksum(next); return true;
}
} // namespace kerumo
