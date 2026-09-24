import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class SnapshotOrderingDecision:
    """Рішення: чи може пакет замінити current state."""

    should_update: bool
    reason: str


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

    Session identity має вищий пріоритет за sequence:
    - нова, раніше невідома session_id означає новий boot;
    - стара вже відома session_id не може повернутися після переходу
      current state на іншу session;
    - усередині однієї session діють sent_at + sequence.
    """

    if not has_snapshot:
        return SnapshotOrderingDecision(True, "initial_snapshot")

    if current_session_id is not None and incoming_session_id is not None:
        if incoming_session_id != current_session_id:
            if incoming_session_seen_before:
                return SnapshotOrderingDecision(False, "old_session_reappeared")
            return SnapshotOrderingDecision(True, "new_session")

    elif current_session_id is None and incoming_session_id is not None:
        # М'яка міграція зі старих payload без session_id.
        return SnapshotOrderingDecision(True, "session_tracking_initialized")

    elif current_session_id is not None and incoming_session_id is None:
        # Після ввімкнення session tracking legacy-пакет без session_id
        # не повинен мати права переписати current state.
        return SnapshotOrderingDecision(False, "missing_session_id")

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
