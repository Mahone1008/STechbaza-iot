"""Validated equipment limits; absent profile forbids frequency changes."""
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.numeric import finite_number


class FrequencyLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min_hz: float = Field(ge=0, le=100)
    max_hz: float = Field(ge=0, le=100)

    @field_validator("min_hz", "max_hz", mode="before")
    @classmethod
    def finite(cls, value):
        number = finite_number(value)
        if number is None:
            raise ValueError("Frequency limit must be a finite number")
        return number

    @model_validator(mode="after")
    def ordered(self):
        if self.min_hz >= self.max_hz:
            raise ValueError("min_hz must be less than max_hz")
        return self


