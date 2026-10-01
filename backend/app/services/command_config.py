import os
from app.schemas.program import ProgramPlan


COMMAND_RETRY_INTERVAL_SECONDS = int(os.getenv("COMMAND_RETRY_INTERVAL_SECONDS", "10"))
if COMMAND_RETRY_INTERVAL_SECONDS < 1:
    raise RuntimeError("COMMAND_RETRY_INTERVAL_SECONDS має бути додатним")

COMMAND_RESULT_TIMEOUT_SECONDS = int(os.getenv("COMMAND_RESULT_TIMEOUT_SECONDS", "120"))
if COMMAND_RESULT_TIMEOUT_SECONDS < 1:
    raise RuntimeError("COMMAND_RESULT_TIMEOUT_SECONDS має бути додатним")


def result_timeout_seconds(command) -> int:
    if command.command_type == "vfd.program.start":
        return ProgramPlan.model_validate(command.payload).result_timeout_seconds
    return COMMAND_RESULT_TIMEOUT_SECONDS
