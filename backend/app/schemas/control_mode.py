"""Режим автоматизації сайта не змінює місцеве/дистанційне джерело частотника."""
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

ControlMode = Literal["manual", "schedule"]


class ControlModeWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    mode: ControlMode
    expected_revision: int = Field(strict=True, ge=0, le=2147483647)


class ControlModeRead(BaseModel):
    device_id: uuid.UUID
    mode: ControlMode
    revision: int = Field(ge=0, le=2147483647)
    changed_at: datetime | None
    enabled_schedule_count: int = Field(ge=0, le=50)
    next_start_at: datetime | None
