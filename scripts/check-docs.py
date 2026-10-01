"""Перевіряє локальні Markdown links і довідник, отриманий з коду.

--write оновлює лише generated-code-reference.md; runtime-сервіси не потрібні.
Зовнішні URL та anchors цей gate не перевіряє.
"""

import argparse
import ast
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "docs/generated-code-reference.md"
sys.path.insert(0, str(ROOT / "backend"))

from app.device_contract import COMMAND_REQUIRED_CAPABILITY, TELEMETRY_CHANNELS  # noqa: E402
from app.security.roles import ORGANIZATION_ROLE_PERMISSIONS, OrganizationRole, Permission  # noqa: E402


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def migration_head() -> tuple[str, int]:
    revisions, parents = set(), set()
    files = sorted((ROOT / "backend/alembic/versions").glob("*.py"))
    for path in files:
        for node in ast.parse(path.read_text(encoding="utf-8")).body:
            if isinstance(node, ast.Assign):
                names = [item.id for item in node.targets if isinstance(item, ast.Name)]
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                names = [node.target.id]
            else:
                continue
            if not set(names) & {"revision", "down_revision"}:
                continue
            value = ast.literal_eval(node.value)
            if "revision" in names:
                revisions.add(value)
            if "down_revision" in names and value is not None:
                parents.update(value if isinstance(value, (list, tuple)) else [value])
    heads = revisions - parents
    if len(heads) != 1:
        raise ValueError(f"Expected one Alembic head, got {sorted(heads)}")
    return heads.pop(), len(revisions)


def reference() -> str:
    schema = json.loads(read("frontend/src/lib/api/openapi.json"))
    package = json.loads(read("frontend/package.json"))
    source = ast.parse(read("backend/app/main.py"))
    app_version = next(ast.literal_eval(kw.value) for node in ast.walk(source)
                       if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                       and node.func.id == "FastAPI" for kw in node.keywords if kw.arg == "version")
    health = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "health")
    health_version = next(ast.literal_eval(value) for node in ast.walk(health)
                          if isinstance(node, ast.Dict) for key, value in zip(node.keys, node.values)
                          if isinstance(key, ast.Constant) and key.value == "version")
    if app_version != schema["info"]["version"] or app_version != health_version:
        raise ValueError("Backend, /health and committed OpenAPI versions differ")
    head, count = migration_head()
    firmware = re.search(r'FirmwareVersion\[\]="(\d+\.\d+\.\d+)"', read("firmware/kerumo_v3/kerumo_v3.ino"))[1]
    lines = ["# Довідник поточної реалізації", "",
             "Генерується `python scripts/check-docs.py --write`. Не редагувати вручну.",
             "CI звіряє його з tracked code. Це перелік реалізації, а не доказ фізичного приймання.",
             "[Статус і відкриті питання](project-status.md).", "", "## Версії", "",
             "| Компонент | Значення з коду |", "|---|---|",
             f"| Backend / OpenAPI / health | {app_version} |",
             f"| Alembic head | `{head}`; {count} міграцій |",
             f"| Frontend package | {package['version']} |",
             f"| Node engine | `{package['engines']['node']}` |",
             f"| Package manager | `{package['packageManager']}` |",
             f"| Next.js / React | {package['dependencies']['next']} / {package['dependencies']['react']} |",
             f"| Firmware V3 | {firmware} |",
             f"| OpenAPI paths | {len(schema['paths'])} |", "", "## Канали телеметрії", "",
             "Джерело: `backend/app/device_contract.py`. Enabled assignment та `telemetry_keys`",
             "обмежують відображення конкретного Device; registry не є переліком встановлених датчиків.", "",
             "| Capability | source | key | Тип | Одиниця | Series |", "|---|---|---|---|---|---|"]
    for c in sorted(TELEMETRY_CHANNELS, key=lambda c: (c.capability_code, c.source, c.key)):
        lines.append(f"| `{c.capability_code}` | {c.source} | `{c.key}` | {c.data_type} | {c.unit or '—'} | {'так' if c.supports_series else 'ні'} |")
    lines += ["", "## Підтримувані команди", "", "| Команда | Потрібна capability |", "|---|---|"]
    lines += [f"| `{key}` | `{value}` |" for key, value in sorted(COMMAND_REQUIRED_CAPABILITY.items())]
    lines += ["", "Порядок, TTL, профіль частоти й outbound v2: [command-safety-v2](command-safety-v2.md).",
              "ACK/Result лишаються v1. Дозвіл API не замінює локальні блокування VFD.", "", "## Tenant permissions", "",
              "Джерело: `backend/app/security/roles.py`. Додаткові owner/platform/resource guards",
              "описані в [RBAC](rbac-multitenant-guards-v1.md).", "",
              "| Permission | " + " | ".join(role.value for role in OrganizationRole) + " |",
              "|---|" + "---|" * len(OrganizationRole)]
    for permission in Permission:
        lines.append(f"| `{permission.value}` | " + " | ".join(
            "так" if permission in ORGANIZATION_ROLE_PERMISSIONS[role] else "—" for role in OrganizationRole) + " |")
    lines += ["", "## HTTP API", "", "Джерело: committed OpenAPI; повні DTO й параметри — `/openapi.json`.",
              "[Авторизація та призначення груп](api-v1.md).", "", "| Path | Methods |", "|---|---|"]
    for path, operations in sorted(schema["paths"].items()):
        methods = [m.upper() for m in operations if m in {"get", "post", "put", "patch", "delete", "head", "options"}]
        lines.append(f"| `{path}` | {', '.join(methods)} |")
    return "\n".join(lines) + "\n"


def check_links() -> tuple[int, list[str]]:
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    files = {ROOT / p for p in tracked if p.endswith(".md")}
    # Нові docs також перевіряються до першого commit.
    files.update((ROOT / "docs").glob("*.md"))
    errors = []
    for path in sorted(files):
        content = re.sub(r"```.*?```", "", path.read_text(encoding="utf-8"), flags=re.S)
        for target in re.findall(r"\]\(([^\s)]+)(?:\s+\"[^\"]*\")?\)", content):
            parsed = urlsplit(target.strip("<>"))
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            destination = (ROOT if parsed.path.startswith("/") else path.parent) / unquote(parsed.path.lstrip("/"))
            if not destination.exists():
                errors.append(f"{path.relative_to(ROOT)}: missing {target}")
    return len(files), errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    expected = reference()
    if args.write:
        REFERENCE.write_text(expected, encoding="utf-8")
    errors = []
    if not REFERENCE.exists() or REFERENCE.read_text(encoding="utf-8") != expected:
        errors.append("Generated reference is stale: run python scripts/check-docs.py --write")
    count, link_errors = check_links()
    errors.extend(link_errors)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"PASS: code reference is current; local file links in {count} Markdown files resolve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
