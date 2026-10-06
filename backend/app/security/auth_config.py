import os
from app.security.plane import APP_PLANE


AUTH_ACCESS_TOKEN_SECRET = os.getenv(
    "AUTH_ACCESS_TOKEN_SECRET",
    "techbaza-local-development-only-secret-change-before-production",
)
AUTH_ACCESS_TOKEN_ALGORITHM = "HS256"
AUTH_ACCESS_TOKEN_TTL_SECONDS = int(
    os.getenv("AUTH_ACCESS_TOKEN_TTL_SECONDS", "900")
)
AUTH_REFRESH_TOKEN_TTL_SECONDS = int(
    os.getenv("AUTH_REFRESH_TOKEN_TTL_SECONDS", "2592000")
)
AUTH_TOKEN_ISSUER = os.getenv("AUTH_TOKEN_ISSUER", "techbaza")
AUTH_TOKEN_AUDIENCE = os.getenv("AUTH_TOKEN_AUDIENCE", "kerumo-staff-api" if APP_PLANE == "staff" else "techbaza-api")


if APP_PLANE == "staff" and (not os.getenv("AUTH_ACCESS_TOKEN_SECRET") or AUTH_TOKEN_AUDIENCE == "techbaza-api"):
    raise RuntimeError("Staff API requires its own token secret and audience")

if len(AUTH_ACCESS_TOKEN_SECRET) < 32:
    raise RuntimeError(
        "AUTH_ACCESS_TOKEN_SECRET має містити щонайменше 32 символи"
    )
