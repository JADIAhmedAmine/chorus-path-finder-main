from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


DEFAULT_AUDIT_LOG_FILE = "config/audit-log.jsonl"
REPO_ROOT = Path(__file__).resolve().parents[1]
_ENV_FILES_LOADED = False


def _env(name: str, default: str = "") -> str:
    global _ENV_FILES_LOADED
    if not _ENV_FILES_LOADED:
        load_dotenv(".env.local", override=False)
        load_dotenv(".env", override=False)
        _ENV_FILES_LOADED = True
    return (os.environ.get(name) or default).strip()


def _audit_log_path() -> Path:
    configured_path = _env("APP_AUDIT_LOG_FILE", DEFAULT_AUDIT_LOG_FILE)
    path = Path(configured_path)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def append_audit_event(event: dict[str, Any]) -> None:
    path = _audit_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": _now_iso(),
        **event,
    }
    with path.open("a", encoding="utf-8") as audit_file:
        audit_file.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")


def read_audit_events(
    *,
    email: str | None = None,
    action: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    path = _audit_log_path()
    if not path.exists():
        return []

    safe_limit = max(1, min(limit, 500))
    normalized_email = email.strip().lower() if email else None
    normalized_action = action.strip() if action else None
    events: list[dict[str, Any]] = []

    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []

    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if normalized_email and str(event.get("email", "")).lower() != normalized_email:
            continue
        if normalized_action and event.get("action") != normalized_action:
            continue
        events.append(event)
        if len(events) >= safe_limit:
            break

    return events
