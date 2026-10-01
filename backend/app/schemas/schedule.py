"""Календарні правила та обмежений план одного запуску."""
import uuid
import calendar
from datetime import date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.program import ProgramPlan, ProgramStep


class FrequencyChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at: time
    day_offset: int = Field(default=0, strict=True, ge=0, le=1)
    frequency_hz: float = Field(gt=0, le=100)

    @field_validator("at")
    @classmethod
    def minute_time(cls, value):
        if value.tzinfo is not None or value.second or value.microsecond:
            raise ValueError("Час має бути місцевим, з точністю до хвилини")
        return value

    @field_validator("frequency_hz", mode="before")
    @classmethod
    def frequency(cls, value):
        return ProgramStep.frequency(value)


class ScheduleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    timezone: str = Field(min_length=1, max_length=80)
    start_date: date
    until_date: date
    start_time: time
    stop_time: time
    stop_day_offset: int = Field(default=0, strict=True, ge=0, le=1)
    frequency_hz: float = Field(gt=0, le=100)
    repeat: Literal["once", "daily", "weekly", "interval", "monthly", "yearly"] = "once"
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    interval_days: int = Field(default=1, strict=True, ge=1, le=366)
    month_day: int = Field(default=1, strict=True, ge=-1, le=31)
    months: list[int] = Field(default_factory=lambda: list(range(1, 13)), min_length=1, max_length=12)
    excluded_dates: list[date] = Field(default_factory=list, max_length=100)
    changes: list[FrequencyChange] = Field(default_factory=list, max_length=7)

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Вкажіть назву розкладу")
        return value.strip()

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ValueError("Невідомий часовий пояс IANA") from exc
        return value

    @field_validator("start_time", "stop_time")
    @classmethod
    def minute_time(cls, value):
        return FrequencyChange.minute_time(value)

    @field_validator("frequency_hz", mode="before")
    @classmethod
    def frequency(cls, value):
        return ProgramStep.frequency(value)

    @field_validator("weekdays", "months", mode="before")
    @classmethod
    def integer_list(cls, value):
        if not isinstance(value, list) or any(type(item) is not int for item in value):
            raise ValueError("Очікується список цілих чисел")
        return value

    @model_validator(mode="after")
    def coherent(self):
        # Обмежений горизонт захищає preview від необмежених обчислень.
        if not date(2000, 1, 1) <= self.start_date <= self.until_date <= date(2199, 12, 31):
            raise ValueError("Період розкладу має бути в межах 2000–2199 років")
        last_year = self.start_date.year + 50
        last_day = min(self.start_date.day, calendar.monthrange(last_year, self.start_date.month)[1])
        if self.until_date > date(last_year, self.start_date.month, last_day):
            raise ValueError("Період дії розкладу — до 50 років")
        if self.repeat == "once" and self.until_date != self.start_date:
            raise ValueError("Для одноразового запуску період дії — одна дата")
        if self.month_day == 0:
            raise ValueError("День місяця: 1–31 або -1 (останній)")
        if len(set(self.weekdays)) != len(self.weekdays) or any(day not in range(7) for day in self.weekdays):
            raise ValueError("Дні тижня: унікальні числа 0–6")
        if self.repeat == "weekly" and not self.weekdays:
            raise ValueError("Оберіть дні тижня")
        if len(set(self.months)) != len(self.months) or any(month not in range(1, 13) for month in self.months):
            raise ValueError("Місяці: унікальні числа 1–12")
        if len(set(self.excluded_dates)) != len(self.excluded_dates):
            raise ValueError("Дати винятків не повинні повторюватися")
        start = datetime.combine(self.start_date, self.start_time)
        stop = datetime.combine(self.start_date + timedelta(days=self.stop_day_offset), self.stop_time)
        if not 60 <= (stop - start).total_seconds() <= 86400:
            raise ValueError("Тривалість запуску — від хвилини до доби")
        previous = start
        for change in self.changes:
            point = datetime.combine(self.start_date + timedelta(days=change.day_offset), change.at)
            if not previous + timedelta(minutes=1) <= point <= stop - timedelta(minutes=1):
                raise ValueError("Зміни частоти мають бути послідовні, всередині запуску, з інтервалом від хвилини")
            previous = point
        return self


class ScheduleRun(ProgramPlan):
    """UTC-межі одного виконання; переходи не пересувають фінальний STOP."""
    starts_at: datetime
    stops_at: datetime

    @model_validator(mode="after")
    def calendar_window(self):
        for value in (self.starts_at, self.stops_at):
            if value.utcoffset() is None or value.microsecond:
                raise ValueError("Межі запуску потребують timezone та цілих секунд")
        seconds = (self.stops_at - self.starts_at).total_seconds()
        if seconds != sum(step.duration_seconds for step in self.steps):
            raise ValueError("Етапи мають точно покривати календарний інтервал")
        return self


class ScheduleWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    expected_revision: int = Field(strict=True, ge=0)
    enabled: bool = Field(strict=True)
    spec: ScheduleSpec


class ScheduleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    device_id: uuid.UUID
    organization_id: uuid.UUID
    revision: int
    enabled: bool
    spec: ScheduleSpec
    next_start_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ScheduleOccurrenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    schedule_id: uuid.UUID
    revision: int
    starts_at: datetime
    stops_at: datetime
    status: str
    reason: str | None
    command_id: uuid.UUID | None
    created_at: datetime


class SchedulePreview(BaseModel):
    runs: list[ScheduleRun]
    conflicts: list[uuid.UUID]
    conflict_horizon_days: int = 366
    notes: list[str]
