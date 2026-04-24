from __future__ import annotations

import base64
import os
import shutil
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any

import fitz
import requests
from dotenv import load_dotenv

try:
    import pdfplumber
except ImportError:
    pdfplumber = None  # type: ignore

ENV_PATH = Path(__file__).resolve().parent.parent / ".env.local"
load_dotenv(dotenv_path=ENV_PATH)

DOCLING_SERVER_URL = os.getenv("DOCLING_SERVER_URL", "").strip()
DOCLING_TIMEOUT = int(os.getenv("DOCLING_TIMEOUT", "1800"))
DOCLING_ENABLE_PICTURE_DESCRIPTION = os.getenv(
    "DOCLING_ENABLE_PICTURE_DESCRIPTION", "false"
).lower()


def _rewrite_pdf_for_docling(input_path: Path) -> Path:
    tmp_dir = Path(tempfile.mkdtemp(prefix="docling_fix_"))
    repaired_path = tmp_dir / input_path.name

    src = fitz.open(str(input_path))
    dst = fitz.open()

    try:
        for page in src:
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            new_page = dst.new_page(width=pix.width, height=pix.height)
            rect = fitz.Rect(0, 0, pix.width, pix.height)
            new_page.insert_image(rect, pixmap=pix)

        dst.save(
            str(repaired_path),
            garbage=4,
            deflate=True,
            clean=True,
        )
    finally:
        dst.close()
        src.close()

    return repaired_path


def _post_pdf_to_docling_server(pdf_path: Path) -> dict[str, Any]:
    if not DOCLING_SERVER_URL:
        raise RuntimeError("DOCLING_SERVER_URL n'est pas défini dans .env")

    with pdf_path.open("rb") as f:
        files = {"file": (pdf_path.name, f, "application/pdf")}
        data = {
            "enable_picture_description": DOCLING_ENABLE_PICTURE_DESCRIPTION,
        }

        response = requests.post(
            DOCLING_SERVER_URL,
            files=files,
            data=data,
            timeout=DOCLING_TIMEOUT,
        )

    response.raise_for_status()
    result = response.json()

    if "markdown" not in result:
        raise RuntimeError("Le serveur Docling n'a pas retourné de champ 'markdown'")

    return result


def _convert_pdf_via_docling_server(pdf_path: Path) -> dict[str, Any]:
    repaired_dir: Path | None = None
    repaired_pdf: Path | None = None

    try:
        return _post_pdf_to_docling_server(pdf_path)
    except Exception as e:
        first_error = str(e)

        repaired_pdf = _rewrite_pdf_for_docling(pdf_path)
        repaired_dir = repaired_pdf.parent

        try:
            return _post_pdf_to_docling_server(repaired_pdf)
        except Exception as e2:
            raise RuntimeError(
                f"Échec Docling pour '{pdf_path.name}'. "
                f"Erreur initiale: {first_error} | "
                f"Erreur après réparation: {e2}"
            ) from e2
        finally:
            if repaired_dir and repaired_dir.exists():
                shutil.rmtree(repaired_dir, ignore_errors=True)


def extract_pdf_text_docling(pdf_path: Path | str) -> str:
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    result = _convert_pdf_via_docling_server(pdf_path)
    markdown = result.get("markdown", "") or ""
    return markdown.strip()


def extract_pdf_text_from_base64_docling(pdf_base64: str) -> str:
    try:
        pdf_bytes = base64.b64decode(pdf_base64)
    except Exception as e:
        raise ValueError(f"Invalid base64 encoding: {e}")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)

    try:
        return extract_pdf_text_docling(tmp_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def extract_pdf_text(pdf_path: Path | str, prefer_docling: bool = True) -> str:
    """
    Extraction principale :
    - Docling d'abord
    - fallback pdfplumber si besoin
    """
    if prefer_docling:
        try:
            return extract_pdf_text_docling(pdf_path)
        except Exception as e:
            print(f"Warning: Docling failed, fallback to pdfplumber: {e}")

    if pdfplumber is None:
        raise ImportError("pdfplumber not installed and Docling failed.")

    return extract_pdf_text_pdfplumber(pdf_path)