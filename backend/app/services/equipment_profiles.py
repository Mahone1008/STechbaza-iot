"""Незмінний каталог; номер ревізії змінюється разом із семантикою профілю."""
import hashlib
import json
from functools import lru_cache
from pathlib import Path

from app.schemas.equipment import ProfileRead


def canonical_json(value: dict) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False)


def configuration_hash(text: str) -> str:
    return hashlib.sha256(text.encode("ascii")).hexdigest()


@lru_cache(maxsize=1)
def _catalog() -> tuple[ProfileRead, ...]:
    entries = json.loads((Path(__file__).parents[1] / "data" / "equipment_profiles.json").read_text(encoding="utf-8"))
    return tuple(ProfileRead(**entry, profile_hash=configuration_hash(canonical_json(entry))) for entry in entries)


def profiles() -> list[ProfileRead]:
    return [entry.model_copy(deep=True) for entry in _catalog()]


def get_profile(profile_id: str, version: int) -> ProfileRead | None:
    return next((entry for entry in profiles() if entry.id == profile_id and entry.version == version), None)
