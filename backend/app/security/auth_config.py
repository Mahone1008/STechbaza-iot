import os


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
AUTH_TOKEN_AUDIENCE = os.getenv("AUTH_TOKEN_AUDIENCE", "techbaza-api")


if len(AUTH_ACCESS_TOKEN_SECRET) < 32:
    raise RuntimeError(
        "AUTH_ACCESS_TOKEN_SECRET має містити щонайменше 32 символи"
    )
