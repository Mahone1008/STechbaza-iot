from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """Credentials для створення authenticated session."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshTokenRequest(BaseModel):
    """Opaque refresh token для ротації access token."""

    refresh_token: str = Field(min_length=32, max_length=512)


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
