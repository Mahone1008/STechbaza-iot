from fastapi import HTTPException, Request, Response

from app.security.browser_config import (
    AUTH_BROWSER_ORIGINS, AUTH_COOKIE_SECURE, CSRF_HEADER,
    REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH,
)


def require_browser_request(request: Request) -> None:
    """Origin allowlist + custom header блокують cross-site simple requests.

    Значення заголовка не є secret: захист спирається на preflight і точний
    Origin, а не на приховування рядка. Відсутній або null Origin заборонено.
    """
    if (request.headers.get("origin") not in AUTH_BROWSER_ORIGINS
            or request.headers.get(CSRF_HEADER) != "1"):
        raise HTTPException(status_code=403, detail="Браузерний origin або CSRF header не дозволено")


def set_refresh_cookie(response: Response, token: str, expires_in: int) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME, token, max_age=expires_in,
        path=REFRESH_COOKIE_PATH, secure=AUTH_COOKIE_SECURE,
        httponly=True, samesite="strict",
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH,
        secure=AUTH_COOKIE_SECURE, httponly=True, samesite="strict",
    )


def read_refresh_cookie(request: Request) -> str | None:
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    return token if token and 32 <= len(token) <= 512 else None


class AuthNoStoreMiddleware:
    """Навіть auth-помилки/валідація не кешуються і не повертають пароль."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith(("/api/v1/auth/", "/api/v1/connect/", "/api/v1/bootstrap/", "/api/v1/factory/")):
            return await self.app(scope, receive, send)

        async def send_no_store(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", [])
                           if k.lower() not in (b"cache-control", b"pragma")]
                message = {**message, "headers": headers + [
                    (b"cache-control", b"no-store"), (b"pragma", b"no-cache"),
                ]}
            await send(message)

        await self.app(scope, receive, send_no_store)
