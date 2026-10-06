from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPOSITORY_ROOT / "backend"
OUTPUT = REPOSITORY_ROOT / "frontend" / "src" / "lib" / "api" / "openapi.json"

sys.path.insert(0, str(BACKEND_ROOT))
os.environ.setdefault(
    "AUTH_ACCESS_TOKEN_SECRET",
    "techbaza-local-development-only-secret-change-before-production",
)
os.environ.setdefault("AUTH_BROWSER_ORIGINS", "http://127.0.0.1:3000")
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")

os.environ.setdefault("ACCOUNT_KEY_SECRET", "schema-export-account-key-not-for-runtime-0000")

from app.main import app  # noqa: E402


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = app.openapi()
    # One generated SDK describes both applications; serving routes stays separate.
    from app.staff_main import app as staff_app
    private = staff_app.openapi()
    payload["paths"].update({key: value for key, value in private["paths"].items() if key.startswith("/api/v1/staff/")})
    payload["components"]["schemas"].update(private["components"]["schemas"])
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Exported OpenAPI {payload['info']['version']} to {OUTPUT}")


if __name__ == "__main__":
    main()
