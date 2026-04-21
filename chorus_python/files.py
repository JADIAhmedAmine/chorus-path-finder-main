from __future__ import annotations

import base64
import mimetypes
from pathlib import Path


def pdf_to_base64(pdf_path: Path) -> str:
    return base64.b64encode(pdf_path.read_bytes()).decode("ascii")


def detect_extension(file_path: Path) -> str:
    return file_path.suffix.lower().lstrip(".") or "pdf"


def detect_mime_type(file_path: Path) -> str:
    guessed, _ = mimetypes.guess_type(file_path.name)
    return guessed or "application/pdf"
