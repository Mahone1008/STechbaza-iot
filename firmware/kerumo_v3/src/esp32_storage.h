#pragma once
#include "core.h"
#include "equipment.h"
#include "journal_upgrade.h"
#include "scoped_journal.h"
#include <Preferences.h>

namespace kerumo {
class NvsStorage final : public Storage {
  const EquipmentBinding &equipment_;
  const bool &managed_;
  Preferences prefs;
  ScopedJournal previous{};

public:
  NvsStorage(const EquipmentBinding &equipment, const bool &managed)
      : equipment_(equipment), managed_(managed) {}
  bool opened = false, needsBinding = false;
  int load(Journal &value) override {
    if (!opened)
      opened = prefs.begin("kerumo-v3", false);
    if (!opened)
      return -1;
    if (!prefs.isKey("journal"))
      return 0;
    const size_t size = prefs.getBytesLength("journal");
    if (size == sizeof(ScopedJournal)) {
      if (prefs.getBytes("journal", &previous, sizeof(previous)) != sizeof(previous) || !validScope(previous))
        return -1;
      value = previous.journal;
    } else if (size == sizeof(ProgramJournalV3)) {
      ProgramJournalV3 legacy{};
      if (prefs.getBytes("journal", &legacy, sizeof(legacy)) != sizeof(legacy) ||
          !upgradeJournal(legacy, value))
        return -1;
      previous = wrapJournal(value, "");
    } else if (size == sizeof(LegacyJournal)) {
      LegacyJournal legacy{};
      if (prefs.getBytes("journal", &legacy, sizeof(legacy)) != sizeof(legacy) ||
          !upgradeJournal(legacy, value))
        return -1;
      previous = wrapJournal(value, "");
    } else {
      if (size != sizeof(value) || prefs.getBytes("journal", &value, sizeof(value)) != sizeof(value) ||
          !validJournal(value))
        return -1;
      previous = wrapJournal(value, "");
    }
    if (std::strcmp(previous.configurationHash, managed_ ? equipment_.hash : "") != 0) {
      needsBinding = true;
      return -1; // No recovery I/O to a different drive.
    }
    needsBinding = false;
    return 1;
  }
  bool save(const Journal &value) override {
    const ScopedJournal scoped = wrapJournal(value, managed_ ? equipment_.hash : "");
    return opened && prefs.putBytes("journal", &scoped, sizeof(scoped)) == sizeof(scoped);
  }
  bool bindStoppedEquipment(const char *uid, bool allowOwnershipChange = false) {
    if (!opened || !managed_ || !needsBinding || !validScope(previous) ||
        (!allowOwnershipChange && std::strcmp(previous.journal.uid, uid) != 0))
      return false;
    // Archive before atomic replacement; power loss leaves either the old locked or the new stopped journal.
    if (prefs.putBytes("previous", &previous, sizeof(previous)) != sizeof(previous))
      return false;
    Journal next = journalForNewBinding(previous.journal);
    if (std::strcmp(previous.journal.uid, uid) != 0) {
      next = Journal{};
      std::strncpy(next.uid, uid, sizeof(next.uid)-1);
      next.checksum = checksum(next);
    }
    if (!save(next)) return false;
    needsBinding = false;
    return true;
  }
};
} // namespace kerumo
