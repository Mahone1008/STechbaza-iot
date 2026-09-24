from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class SnapshotOrderingDecision:
    """Рішення: чи може пакет замінити current state."""

    should_update: bool
    reason: str


def decide_snapshot_update(
    *,
    current_reported_at: datetime | None,
    current_sequence: int | None,
    incoming_reported_at: datetime | None,
    incoming_sequence: int | None,
    has_snapshot: bool,
) -> SnapshotOrderingDecision:
    """Не дозволяє старому пакету відкотити актуальний snapshot.

    Пріоритет:
    1. sent_at, якщо він є з обох боків;
    2. sequence як tie-breaker або fallback;
    3. якщо ordering metadata недостатньо — існуючий snapshot не чіпаємо.
    """

    if not has_snapshot:
        return SnapshotOrderingDecision(True, "initial_snapshot")

    if current_reported_at is not None and incoming_reported_at is not None:
        if incoming_reported_at > current_reported_at:
            return SnapshotOrderingDecision(True, "newer_sent_at")
        if incoming_reported_at < current_reported_at:
            return SnapshotOrderingDecision(False, "older_sent_at")

        # Однаковий sent_at: sequence уточнює порядок пакетів.
        if current_sequence is not None and incoming_sequence is not None:
            if incoming_sequence > current_sequence:
                return SnapshotOrderingDecision(True, "same_time_higher_sequence")
            return SnapshotOrderingDecision(False, "same_time_non_increasing_sequence")

        return SnapshotOrderingDecision(False, "same_time_without_sequence_order")

    # Якщо timestamp відсутній хоча б з одного боку, обережно використовуємо
    # sequence. Це корисно для коротких розривів зв'язку в межах однієї сесії.
    if current_sequence is not None and incoming_sequence is not None:
        if incoming_sequence > current_sequence:
            return SnapshotOrderingDecision(True, "higher_sequence_fallback")
        return SnapshotOrderingDecision(False, "non_increasing_sequence_fallback")

    if current_reported_at is None and incoming_reported_at is not None:
        return SnapshotOrderingDecision(True, "incoming_has_sent_at")

    if current_sequence is None and incoming_sequence is not None:
        return SnapshotOrderingDecision(True, "incoming_has_sequence")

    return SnapshotOrderingDecision(False, "insufficient_ordering_metadata")
