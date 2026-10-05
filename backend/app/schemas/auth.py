from typing import Literal

import uuid
from pydantic import BaseModel, ConfigDict, Field, model_validator


class LoginRequest(BaseModel):
    """Credentials для створення authenticated session."""

    model_config = ConfigDict(extra="forbid")
    otp: str | None = Field(default=None, pattern=r"^[0-9]{6}$")
    # `email` remains the wire name for compatibility with existing clients.
    email: str | None = Field(default=None, min_length=1, max_length=320)
    controller_id: uuid.UUID | None = None
    password: str = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def one_identity(self):
        if (self.email is None) == (self.controller_id is None):
            raise ValueError("Вкажіть логін або контролер із QR")
        return self


class RefreshTokenRequest(BaseModel):
    """Opaque refresh token для ротації access token."""

    refresh_token: str = Field(min_length=32, max_length=512)


class MfaLoginErrorDetail(BaseModel):
    code: Literal["mfa_required", "mfa_invalid"]
    message: str


class LoginErrorResponse(BaseModel):
    detail: str | MfaLoginErrorDetail


class LogoutRequest(BaseModel):
    """Refresh token session, яку потрібно відкликати."""

    refresh_token: str = Field(min_length=32, max_length=512)


class TokenResponse(BaseModel):
    """Token pair, що повертається login/refresh flow."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    refresh_token: str
    refresh_expires_in: int


class BrowserTokenResponse(BaseModel):
    """Refresh secret залишається лише в HttpOnly cookie, access — у пам'яті UI."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    session_expires_in: int
    onboarding_path: str | None = None
