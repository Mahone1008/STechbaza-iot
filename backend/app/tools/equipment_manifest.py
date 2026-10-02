"""Перетворює завантажений manifest на локальний include, без зміни credentials."""
import argparse
import json
import sys
from pathlib import Path

from app.schemas.equipment import EquipmentManifest
from app.services.equipment_profiles import canonical_json, configuration_hash, get_profile


def header(text: str) -> str:
    manifest = EquipmentManifest.model_validate_json(text)
    if text != canonical_json(manifest.model_dump(mode="json")):
        raise ValueError("Use exact canonical bytes from the equipment/manifest endpoint")
    profile = get_profile(manifest.profile_id, manifest.profile_version)
    if (profile is None or profile.support != "bench_limited" or manifest.profile_hash != profile.profile_hash
            or manifest.driver_id != profile.driver_id or manifest.driver_version != profile.driver_version):
        raise ValueError("Unsupported equipment profile")
    # JSON string escaping produces a valid C++ literal; it cannot inject source code.
    return ("// Local commissioning manifest. No credentials. Do not commit.\n#pragma once\n"
            f"// SHA-256: {configuration_hash(text)}\n"
            f"#define KERUMO_EQUIPMENT_JSON {json.dumps(text, ensure_ascii=True)}\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = header(args.manifest.read_text(encoding="ascii"))
    except ValueError as exc:
        parser.error(str(exc))
    if args.output:
        with args.output.open("x", encoding="ascii", newline="\n") as stream:
            stream.write(result)
    else:
        sys.stdout.write(result)


if __name__ == "__main__":
    main()
