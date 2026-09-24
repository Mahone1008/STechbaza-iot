import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class SnapshotOrderingDecision:
    """Рішення: чи може пакет замінити current state."""

    should_update: bool
    reason: str


def _legacy_ordering(
    *,
    current_reported_at: datetime | None,
    current_sequence: int | None,
    incoming_reported_at: datetime | None,
    incoming_sequence: int | None,
) -> SnapshotOrderingDecision:
    """Fallback для старих payload без session_id."""

    if current_reported_at is not None and incoming_reported_at is not None:
        if incoming_reported_at > current_reported_at:
            return SnapshotOrderingDecision(True, "newer_sent_at")
        if incoming_reported_at < current_reported_at:
            return SnapshotOrderingDecision(False, "older_sent_at")

        if current_sequence is not None and incoming_sequence is not None:
            if incoming_sequence > current_sequence:
                return SnapshotOrderingDecision(True, "same_time_higher_sequence")
            return SnapshotOrderingDecision(False, "same_time_non_increasing_sequence")

        return SnapshotOrderingDecision(False, "same_time_without_sequence_order")

    if current_sequence is not None and incoming_sequence is not None:
        if incoming_sequence > current_sequence:
            return SnapshotOrderingDecision(True, "higher_sequence_fallback")
        return SnapshotOrderingDecision(False, "non_increasing_sequence_fallback")

    if current_reported_at is None and incoming_reported_at is not None:
        return SnapshotOrderingDecision(True, "incoming_has_sent_at")

    if current_sequence is None and incoming_sequence is not None:
        return SnapshotOrderingDecision(True, "incoming_has_sequence")

    return SnapshotOrderingDecision(False, "insufficient_ordering_metadata")


def decide_snapshot_update(
    *,
    current_session_id: uuid.UUID | None,
    current_reported_at: datetime | None,
    current_sequence: int | None,
    incoming_session_id: uuid.UUID | None,
    incoming_reported_at: datetime | None,
    incoming_sequence: int | None,
    incoming_session_seen_before: bool,
    has_snapshot: bool,
) -> SnapshotOrderingDecision:
    """Захищає current state від stale-пакетів і старих boot-сесій.

    Для payload із session_id:
    1. session identity визначає reboot;
    2. усередині однієї session sequence є головним порядком;
    3. sent_at використовується як fallback, якщо sequence відсутній.

    Для legacy payload без session_id зберігається попередня логіка.
    """

    if not has_snapshot:
        return SnapshotOrderingDecision(True, "initial_snapshot")

    if current_session_id is not None and incoming_session_id is not None:
        if incoming_session_id != current_session_id:
            if incoming_session_seen_before:
                return SnapshotOrderingDecision(False, "old_session_reappeared")
            return SnapshotOrderingDecision(True, "new_session")

        # Усередині одного boot sequence надійніший за годинник ESP32.
        if current_sequence is not None and incoming_sequence is not None:
            if incoming_sequence > current_sequence:
                return SnapshotOrderingDecision(True, "higher_sequence_same_session")
            return SnapshotOrderingDecision(False, "non_increasing_sequence_same_session")

        if current_reported_at is not None and incoming_reported_at is not None:
            if incoming_reported_at > current_reported_at:
                return SnapshotOrderingDecision(True, "newer_sent_at_same_session")
            return SnapshotOrderingDecision(False, "non_newer_sent_at_same_session")

        if current_sequence is None and incoming_sequence is not None:
            return SnapshotOrderingDecision(True, "incoming_sequence_same_session")

        if current_reported_at is None and incoming_reported_at is not None:
            return SnapshotOrderingDecision(True, "incoming_sent_at_same_session")

        return SnapshotOrderingDecision(False, "insufficient_ordering_same_session")

    if current_session_id is None and incoming_session_id is not None:
        # Перший session-aware пакет переводить snapshot на нову модель.
        return SnapshotOrderingDecision(True, "session_tracking_initialized")

    if current_session_id is not None and incoming_session_id is None:
        # Після переходу на session-aware протокол legacy-пакет без session_id
        # не має права переписувати current state.
        return SnapshotOrderingDecision(False, "missing_session_id")

    return _legacy_ordering(
        current_reported_at=current_reported_at,
        current_sequence=current_sequence,
        incoming_reported_at=incoming_reported_at,
        incoming_sequence=incoming_sequence,
    )
