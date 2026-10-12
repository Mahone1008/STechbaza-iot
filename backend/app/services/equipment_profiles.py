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
    """Profiles offered for a new equipment selection."""
    return [entry.model_copy(deep=True) for entry in _catalog() if selectable_manufacturer(entry.manufacturer)]


def selectable_manufacturer(manufacturer: str) -> bool:
    return manufacturer.strip().casefold() == "suswe"


def get_profile(profile_id: str, version: int) -> ProfileRead | None:
    # Historical passports/configurations retain their immutable profiles even
    # when a manufacturer is no longer offered for a new selection.
    entry = next((entry for entry in _catalog() if entry.id == profile_id and entry.version == version), None)
    return entry.model_copy(deep=True) if entry else None
