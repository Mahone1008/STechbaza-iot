"""Model-scoped service commands. Raw words never select arbitrary addresses."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SourceChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["local", "remote"]
    expected_run_source: int = Field(strict=True, ge=0, le=2)
    expected_frequency_source: int = Field(strict=True, ge=0, le=7)


class ParameterChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Literal["F0.10", "F0.11"]
    expected_raw: int = Field(strict=True, ge=0, le=9999)
    value_raw: int = Field(strict=True, ge=1, le=9999)


class VfdSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    driver_id: Literal["su600"]
    ready: bool = Field(strict=True)
    command_sequence: int = Field(strict=True, ge=0, le=9007199254740991)
    run_source: int | None = Field(strict=True, ge=0, le=2)
    frequency_source: int | None = Field(strict=True, ge=0, le=7)
    parameters: dict[Literal["F0.10", "F0.11"], int | None]

    @field_validator("parameters", mode="before")
    @classmethod
    def known_words(cls, value):
        if not isinstance(value, dict) or set(value) != {"F0.10", "F0.11"} or any(
            raw is not None and (type(raw) is not int or not 0 <= raw <= 9999)
            for raw in value.values()
        ):
            raise ValueError("Both whitelisted parameters require a raw word or null")
        return value

