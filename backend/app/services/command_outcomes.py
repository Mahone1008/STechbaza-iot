"""Припинення доставки без припущення, що відсутність відповіді означає невиконання."""
from app.services.system_alarms import SystemAlarmService


def stop_delivery(session, command, now, *, code, message, unsent_status="cancelled"):
    attempted = command.status in {"published", "acknowledged"} or bool(command.publish_attempts or command.published_at or command.acknowledged_at)
    command.status = "result_unknown" if attempted else unsent_status
    command.error_code = code
    command.error_message = message
    command.completed_at = None if attempted else now
    if attempted:
        command.result_timed_out_at = now
        SystemAlarmService(session).record_result_timeout(command=command, occurred_at=now)
    elif unsent_status == "expired":
        SystemAlarmService(session).record_command_outcome(command=command, occurred_at=now)
