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
inline uint32_t legacyChecksum(const LegacyJournal& value) {
  const auto* bytes=reinterpret_cast<const uint8_t*>(&value); uint32_t crc=0xFFFFFFFFU;
  for (size_t i=0;i<sizeof(value);++i) {
    crc^=i>=offsetof(LegacyJournal,checksum) && i<offsetof(LegacyJournal,checksum)+4?0:bytes[i];
    for(unsigned bit=0;bit<8;++bit) crc=(crc>>1)^(0xEDB88320U&(0U-(crc&1U)));
  }
  return ~crc;
}
inline bool upgradeJournal(const LegacyJournal& old,Journal& next) {
  if (old.magic!=0x4B563301 || old.checksum!=legacyChecksum(old) || old.next>=LedgerSize ||
      old.highest>MaxSequence || !std::memchr(old.uid,0,sizeof(old.uid))) return false;
  next=Journal{}; std::memcpy(next.uid,old.uid,sizeof(old.uid));
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
