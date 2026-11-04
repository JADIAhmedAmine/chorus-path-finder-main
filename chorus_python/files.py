from __future__ import annotations

import base64
import binascii
import mimetypes
from pathlib import Path


PDF_SIGNATURE_MARKERS = (
    b"/Type/Sig",
    b"/Type /Sig",
    b"/ByteRange",
    b"/SubFilter",
    b"/SigFlags",
    b"adbe.pkcs7.detached",
    b"ETSI.CAdES.detached",
)


def pdf_to_base64(pdf_path: Path) -> str:
    return base64.b64encode(pdf_path.read_bytes()).decode("ascii")


def detect_extension(file_path: Path) -> str:
    return file_path.suffix.lower().lstrip(".") or "pdf"


def detect_mime_type(file_path: Path) -> str:
    guessed, _ = mimetypes.guess_type(file_path.name)
    return guessed or "application/pdf"


def is_signed_pdf_content(content: bytes) -> bool:
    if not content.lstrip().startswith(b"%PDF"):
        return False

    return any(marker in content for marker in PDF_SIGNATURE_MARKERS)


def is_signed_pdf_base64(value: str) -> bool:
    raw_value = value.strip()
    if raw_value.startswith("data:") and "," in raw_value:
        raw_value = raw_value.split(",", 1)[1]

    try:
        content = base64.b64decode("".join(raw_value.split()), validate=True)
    except (binascii.Error, ValueError):
        return False

    return is_signed_pdf_content(content)


def is_signed_pdf_path(pdf_path: Path) -> bool:
    try:
        return is_signed_pdf_content(pdf_path.read_bytes())
    except OSError:
        return False
