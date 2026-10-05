"""Long-lived account/device keys have a lifecycle independent of JWT signing."""

import json
import os

LOCAL_ACCOUNT_KEY = "techbaza-local-development-only-secret-change-before-production"


def load_account_keys() -> tuple[str, ...]:
    primary = os.getenv("ACCOUNT_KEY_SECRET")
    if primary is None:
        # Existing deployments must preserve the old JWT secret once, explicitly.
        # A silent fallback would couple every future JWT rotation to stored data.
        if os.getenv("AUTH_ACCESS_TOKEN_SECRET", LOCAL_ACCOUNT_KEY) != LOCAL_ACCOUNT_KEY:
            raise RuntimeError(
                "Set ACCOUNT_KEY_SECRET to the previous AUTH_ACCESS_TOKEN_SECRET "
                "before upgrading; keep it unchanged when rotating JWT signing."
            )
        primary = LOCAL_ACCOUNT_KEY
    try:
        previous = json.loads(os.getenv("ACCOUNT_KEY_PREVIOUS_SECRETS", "[]"))
    except (ValueError, TypeError) as exc:
        raise RuntimeError("ACCOUNT_KEY_PREVIOUS_SECRETS must be a JSON array") from exc
    if not isinstance(previous, list) or len(previous) > 3:
        raise RuntimeError("ACCOUNT_KEY_PREVIOUS_SECRETS supports at most three previous keys")
    keys = (primary, *previous)
    if any(not isinstance(key, str) or len(key) < 32 for key in keys):
        raise RuntimeError("Each account key must contain at least 32 characters")
    if len(set(keys)) != len(keys):
        raise RuntimeError("Account keys must be distinct")
    return keys


ACCOUNT_KEYS = load_account_keys()
