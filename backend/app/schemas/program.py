"""Обмежені програми витримки, незалежні від транспорту; v1 завершується STOP."""
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.numeric import finite_number

MAX_PROGRAM_STEPS = 8
MAX_PROGRAM_SECONDS = 86400
PROGRAM_TRANSITION_SECONDS = 60
PROGRAM_ACTIVE_STATES = {"setting", "starting", "holding", "stopping"}


class ProgramStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    frequency_hz: float = Field(gt=0, le=100)
    duration_seconds: int = Field(strict=True, ge=10, le=MAX_PROGRAM_SECONDS)

    @field_validator("frequency_hz", mode="before")
    @classmethod
    def frequency(cls, value):
        number = finite_number(value)
        if number is None or abs(number * 100 - round(number * 100)) > 0.000001:
            raise ValueError("Program frequency must be numeric with at most two decimal places")
        return number


class ProgramPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    steps: list[ProgramStep] = Field(min_length=1, max_length=MAX_PROGRAM_STEPS)

    @field_validator("version", mode="before")
    @classmethod
    def version_number(cls, value):
        if type(value) is not int:
            raise ValueError("Program version must be an integer")
        return value

    @model_validator(mode="after")
    def bounded_duration(self):
        if sum(step.duration_seconds for step in self.steps) > MAX_PROGRAM_SECONDS:
            raise ValueError("Total holding time cannot exceed 24 hours")
        return self

    @property
    def result_timeout_seconds(self):
        # Кожен перехід частоти та фінальний STOP мають строк підтвердження.
        return sum(step.duration_seconds for step in self.steps) + (len(self.steps) + 1) * PROGRAM_TRANSITION_SECONDS + 120


class ProgramProgress(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    ready: bool = Field(strict=True)
    command_id: uuid.UUID | None
    state: Literal["idle", "setting", "starting", "holding", "stopping", "completed", "interrupted", "failed"]
    step_index: int = Field(strict=True, ge=0, le=MAX_PROGRAM_STEPS)
    step_count: int = Field(strict=True, ge=0, le=MAX_PROGRAM_STEPS)
    target_frequency_hz: float | None = Field(ge=0, le=100)
    remaining_seconds: int | None = Field(strict=True, ge=0, le=MAX_PROGRAM_SECONDS)
    reason: str | None = Field(max_length=96)

    @field_validator("version", mode="before")
    @classmethod
    def version_number(cls, value):
        return ProgramPlan.version_number(value)

    @field_validator("target_frequency_hz", mode="before")
    @classmethod
    def frequency_number(cls, value):
        if value is not None and finite_number(value) is None:
            raise ValueError("Program target must be numeric or null")
        return value

    @model_validator(mode="after")
    def consistent(self):
        if self.step_index > self.step_count:
            raise ValueError("Program step exceeds step count")
        if self.state == "idle":
            if self.command_id is not None or self.step_index or self.step_count or self.target_frequency_hz is not None or self.remaining_seconds is not None or self.reason is not None:
                raise ValueError("Idle progress cannot describe an execution")
        elif self.command_id is None or self.step_count == 0:
            raise ValueError("Execution progress requires an identity and steps")
        if self.state in {"setting", "starting", "holding"} and (self.step_index == 0 or self.target_frequency_hz is None):
            raise ValueError("Active step requires a target")
        if self.state == "holding" and self.remaining_seconds is None:
            raise ValueError("Holding progress requires remaining time")
        return self
