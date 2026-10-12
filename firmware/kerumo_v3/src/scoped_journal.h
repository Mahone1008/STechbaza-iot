#pragma once
#include "equipment.h"
#include "journal_upgrade.h"

namespace kerumo {
// Versioned wrapper; old scoped/calendar records migrate without resetting sequence.
struct ScopedJournal {
  uint32_t magic{0x4B563306}, checksum{};
  char configurationHash[65]{};
  Journal journal{};
};
struct ScopedCalendarV4 {
  uint32_t magic{0x4B563304}, checksum{};
  char configurationHash[65]{};
  CalendarJournalV5 journal{};
};
inline bool upgradeScope(const ScopedCalendarV4& old, ScopedJournal& next) {
  if (old.magic != 0x4B563304 || old.checksum != legacyChecksum(old) ||
      old.configurationHash[64] != 0 ||
      (old.configurationHash[0] && !validHash(old.configurationHash)) ||
      !upgradeJournal(old.journal, next.journal)) return false;
  std::memcpy(next.configurationHash, old.configurationHash, sizeof(old.configurationHash));
  return true;
}
inline uint32_t scopeChecksum(const ScopedJournal& value) {
  const auto* bytes=reinterpret_cast<const uint8_t*>(&value);
  uint32_t crc=0xFFFFFFFFU;
  for (size_t i=0;i<sizeof(value);++i) {
    const uint8_t byte=i>=offsetof(ScopedJournal,checksum) && i<offsetof(ScopedJournal,checksum)+4?0:bytes[i];
    crc^=byte;
    for (unsigned bit=0;bit<8;++bit) crc=(crc>>1)^(0xEDB88320U & (0U-(crc&1U)));
  }
  return ~crc;
}
inline bool validJournal(const Journal& value) {
  return value.magic==0x4B563305 && value.checksum==checksum(value) &&
    value.highest<=MaxSequence && value.next<LedgerSize && std::memchr(value.uid,0,sizeof(value.uid));
}
inline bool validScope(const ScopedJournal& value) {
  return value.magic==0x4B563306 && value.checksum==scopeChecksum(value) &&
    value.configurationHash[64]==0 && (value.configurationHash[0]==0 || validHash(value.configurationHash)) && validJournal(value.journal);
}
inline ScopedJournal wrapJournal(const Journal& journal, const char* hash) {
  ScopedJournal value{}; value.journal=journal;
  std::strncpy(value.configurationHash,hash,64); value.checksum=scopeChecksum(value);
  return value;
}
inline Journal journalForNewBinding(const Journal& previous) {
  Journal fresh{};
  std::memcpy(fresh.uid,previous.uid,sizeof(fresh.uid)); fresh.highest=previous.highest;
  fresh.checksum=checksum(fresh);
  return fresh; // Prior intent must never issue STOP/START to a replacement drive.
}
} // namespace kerumo
