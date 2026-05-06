from __future__ import annotations

import base64
import os
import re
import shutil
import tempfile
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
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

MONEY_QUANTIZER = Decimal("0.01")
AMOUNT_PATTERN = r"([0-9][0-9\s.'’,]*(?:[,.][0-9]{2})?)"


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
        docling_text = extract_pdf_text_docling(tmp_path)
        try:
            pdfplumber_text = extract_pdf_text_pdfplumber(tmp_path)
        except Exception:
            pdfplumber_text = ""
        return _prepend_reconciled_invoice_totals(
            _merge_text_sources(docling_text, pdfplumber_text)
        )
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def _normalize_extracted_text(text: str) -> str:
    lines = [" ".join(line.split()) for line in text.replace("\r", "\n").splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _merge_text_sources(*sources: str) -> str:
    merged_lines: list[str] = []
    seen: set[str] = set()

    for source in sources:
        for line in _normalize_extracted_text(source).splitlines():
            key = line.casefold()
            if key in seen:
                continue

            seen.add(key)
            merged_lines.append(line)

    return "\n".join(merged_lines).strip()


def _parse_decimal_amount(value: str | None) -> Decimal | None:
    if not value:
        return None

    cleaned = (
        value.strip()
        .replace("\u00a0", " ")
        .replace("'", "")
        .replace("’", "")
    )
    cleaned = re.sub(r"[^\d,.\-]", "", cleaned)
    if not cleaned or not re.search(r"\d", cleaned):
        return None

    last_comma = cleaned.rfind(",")
    last_dot = cleaned.rfind(".")
    normalized = cleaned
    if last_comma > last_dot:
        normalized = cleaned.replace(".", "").replace(",", ".")
    elif last_dot > last_comma and last_comma >= 0:
        normalized = cleaned.replace(",", "")
    elif last_comma >= 0:
        normalized = cleaned.replace(",", ".")

    try:
        return Decimal(normalized).quantize(MONEY_QUANTIZER, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return None


def _format_decimal_amount(value: Decimal) -> str:
    return f"{value:,.2f}".replace(",", " ").replace(".", ",")


def _first_amount(text: str, patterns: list[str]) -> Decimal | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        amount = _parse_decimal_amount(match.group(1) if match else None)
        if amount is not None:
            return amount

    return None


def _extract_vat_rate(text: str) -> str | None:
    match = re.search(r"\btva\s*([0-9]{1,2}(?:[,.][0-9]+)?)\s*%", text, re.IGNORECASE)
    if not match:
        return None

    rate = match.group(1).replace(",", ".")
    return rate.rstrip("0").rstrip(".") if "." in rate else rate


def _prepend_reconciled_invoice_totals(text: str) -> str:
    normalized_text = _normalize_extracted_text(text)
    amount = AMOUNT_PATTERN
    total_ttc = _first_amount(normalized_text, [
        rf"\btotal\s*ttc\s*[:#-]?\s*{amount}",
        rf"\bmontant\s*ttc\s*[:#-]?\s*{amount}",
        rf"\b(?:net\s+a\s+payer|net\s+à\s+payer)\b[^0-9]{{0,35}}{amount}",
    ])
    total_vat = _first_amount(normalized_text, [
        rf"\b(?:montant\s+tva|total\s+tva)\s*[:#-]?\s*{amount}",
        rf"\btva\s*[0-9]{{1,2}}(?:[,.][0-9]+)?\s*%\s*[:#-]?\s*{amount}",
    ])

    if total_ttc is None or total_vat is None:
        return normalized_text

    computed_ht = (total_ttc - total_vat).quantize(MONEY_QUANTIZER, rounding=ROUND_HALF_UP)
    if computed_ht <= 0:
        return normalized_text

    extracted_ht = _first_amount(normalized_text, [
        rf"\btotal\s*ht\s*[:#-]?\s*{amount}",
        rf"\bhors\s*taxes\s*[:#-]?\s*{amount}",
        rf"\bmontant\s*ht\s*[:#-]?\s*{amount}",
    ])
    vat_rate = _extract_vat_rate(normalized_text)
    vat_label = f"TVA {vat_rate}%" if vat_rate else "Montant TVA"
    control_status = "OK"
    if extracted_ht is None:
        control_status = "HT extrait absent"
    elif abs(extracted_ht - computed_ht) > Decimal("0.02"):
        control_status = f"HT extrait {_format_decimal_amount(extracted_ht)} corrigé"

    reconciled_block = "\n".join([
        f"Total HT : {_format_decimal_amount(computed_ht)}",
        f"{vat_label} : {_format_decimal_amount(total_vat)}",
        f"Total TTC : {_format_decimal_amount(total_ttc)}",
        f"Controle montant HT TTC moins TVA : {control_status}",
    ])

    return _merge_text_sources(reconciled_block, normalized_text)


def extract_pdf_text_pdfplumber(pdf_path: Path | str) -> str:
    if pdfplumber is None:
        raise ImportError("pdfplumber is not installed.")

    page_texts: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            layout_text = page.extract_text(
                x_tolerance=1,
                y_tolerance=3,
                layout=True,
            ) or ""
            simple_text = page.extract_text(
                x_tolerance=1,
                y_tolerance=3,
                layout=False,
            ) or ""
            page_texts.append(_merge_text_sources(layout_text, simple_text))

    return _merge_text_sources(*page_texts)


def extract_pdf_text(pdf_path: Path | str, prefer_docling: bool = True) -> str:
    """
    Extraction principale :
    - Docling d'abord
    - fusion avec pdfplumber layout pour conserver les zones de totaux parfois
      omises par le markdown Docling
    - fallback pdfplumber si Docling est indisponible
    """
    pdfplumber_text = ""
    pdfplumber_error: Exception | None = None
    try:
        pdfplumber_text = extract_pdf_text_pdfplumber(pdf_path)
    except Exception as e:
        pdfplumber_error = e

    if prefer_docling:
        try:
            return _prepend_reconciled_invoice_totals(
                _merge_text_sources(extract_pdf_text_docling(pdf_path), pdfplumber_text)
            )
        except Exception as e:
            print(f"Warning: Docling failed, fallback to pdfplumber: {e}")

    if pdfplumber_text:
        return _prepend_reconciled_invoice_totals(pdfplumber_text)

    if pdfplumber_error is not None:
        raise RuntimeError(f"Extraction pdfplumber impossible: {pdfplumber_error}") from pdfplumber_error

    raise RuntimeError("Extraction PDF impossible: aucun texte exploitable.")
