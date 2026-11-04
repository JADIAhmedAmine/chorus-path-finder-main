"""Extraction best-effort des champs d'une facture PDF « visuelle ».

Ce module transforme un PDF de facture normal (non Factur-X) en un brouillon
structuré que l'utilisateur DOIT relire/corriger avant toute génération de XML
ou dépôt. Il n'appelle jamais Chorus et n'expose aucun secret.

Sécurité :
- aucune donnée n'est envoyée à un service externe : l'extraction de texte est
  purement locale (PyMuPDF + pdfplumber via ``extract_pdf_text(..., prefer_docling=False)``) ;
- le contenu du PDF et le brouillon généré ne sont jamais journalisés.

L'extraction par expressions régulières est volontairement conservatrice : on
préfère renvoyer ``null`` + un avertissement plutôt qu'une valeur fausse. La
validation humaine reste obligatoire (voir ``chorus_pdf_to_flux_service``).
"""

from __future__ import annotations

import re
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import Any

from .extraction import (
    AMOUNT_PATTERN,
    _extract_vat_rate,
    _first_amount,
    _parse_decimal_amount,
    extract_pdf_text,
)

DEFAULT_FORMAT_FLUX_TARGET = "IN_DP_E1_STRUCT"
DEFAULT_SYNTAXE_FLUX_TARGET = "IN_DP_E1_UBL_INVOICE"
FALLBACK_LINE_DESCRIPTION = "Prestation / Produit extrait de la facture PDF"

_MONTHS_FR = {
    "janvier": 1, "février": 2, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5,
    "juin": 6, "juillet": 7, "août": 8, "aout": 8, "septembre": 9,
    "octobre": 10, "novembre": 11, "décembre": 12, "decembre": 12,
}


def empty_draft() -> dict[str, Any]:
    """Squelette de brouillon (toujours la même forme, champs à ``null``)."""
    return {
        "supplier": {"name": None, "siret": None, "vat_number": None, "address": None},
        "customer": {
            "name": None,
            "siret": None,
            "service_code": None,
            "engagement_number": None,
            "address": None,
        },
        "invoice": {
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": "EUR",
            "total_ht": None,
            "total_tva": None,
            "total_ttc": None,
            "payment_terms": None,
        },
        "vat_breakdown": [],
        "lines": [],
        "chorus": {
            "cadre_facturation": None,
            "service_code": None,
            "engagement_number": None,
            "format_flux_target": DEFAULT_FORMAT_FLUX_TARGET,
            "syntaxe_flux_target": DEFAULT_SYNTAXE_FLUX_TARGET,
        },
    }


# ---------------------------------------------------------------------------
# Normalisations
# ---------------------------------------------------------------------------
def _amount_to_float(value: Decimal | None) -> float | None:
    return float(value) if value is not None else None


def _clean_siret(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    return digits if len(digits) == 14 else None


def _normalize_date(raw: str | None) -> str | None:
    if not raw:
        return None
    text = raw.strip()
    # YYYY-MM-DD déjà normalisé
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", text)
    if iso:
        return text
    # DD/MM/YYYY ou DD-MM-YYYY ou DD.MM.YYYY
    dmy = re.match(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$", text)
    if dmy:
        day, month, year = int(dmy.group(1)), int(dmy.group(2)), int(dmy.group(3))
        if year < 100:
            year += 2000
        return _safe_iso(year, month, day)
    # 26 mai 2026
    fr = re.match(r"^(\d{1,2})\s+([A-Za-zéûôà]+)\.?\s+(\d{4})$", text)
    if fr:
        month = _MONTHS_FR.get(fr.group(2).lower())
        if month:
            return _safe_iso(int(fr.group(3)), month, int(fr.group(1)))
    return None


def _safe_iso(year: int, month: int, day: int) -> str | None:
    if 1 <= month <= 12 and 1 <= day <= 31:
        return f"{year:04d}-{month:02d}-{day:02d}"
    return None


def _find_date(text: str, label_pattern: str) -> str | None:
    date_token = r"(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-zéûôà]+\.?\s+\d{4})"
    match = re.search(label_pattern + r"[^0-9A-Za-z]{0,12}" + date_token, text, re.IGNORECASE)
    return _normalize_date(match.group(1)) if match else None


# ---------------------------------------------------------------------------
# Extraction principale
# ---------------------------------------------------------------------------
def _extract_text(file_bytes: bytes) -> str:
    """Extraction de texte 100% locale (jamais d'envoi externe)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as handle:
        handle.write(file_bytes)
        handle.flush()
        return extract_pdf_text(Path(handle.name), prefer_docling=False)


def extract_invoice_draft(file_bytes: bytes, filename: str) -> dict[str, Any]:
    """Retourne ``{draft, confidence, warnings}`` à partir d'un PDF de facture."""
    draft = empty_draft()
    confidence: dict[str, float] = {}
    warnings: list[str] = []

    try:
        text = _extract_text(file_bytes)
    except Exception:  # noqa: BLE001 - on ne journalise pas le contenu
        text = ""

    if not text.strip():
        warnings.append(
            "Aucun texte exploitable n'a pu être extrait du PDF (document scanné/image ?). "
            "Saisissez les champs manuellement."
        )
        return {"draft": draft, "confidence": confidence, "warnings": warnings}

    # --- Numéro de facture --------------------------------------------------
    invoice_number = None
    for pattern in (
        r"facture\s*(?:n[°ºo]|num[ée]ro|num|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-/_.]{2,})",
        r"(?:invoice|facture)\s*[:#]?\s*([A-Z]{0,4}\d{4}[-/]?\d{2,})",
        r"\b((?:FA|FAC|INV)[-/]?\d{3,})\b",
    ):
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            invoice_number = match.group(1).strip().rstrip(".")
            break
    if invoice_number:
        draft["invoice"]["invoice_number"] = invoice_number
        confidence["invoice_number"] = 0.7

    # --- Dates --------------------------------------------------------------
    invoice_date = _find_date(text, r"date\s*(?:de\s*)?(?:facture|facturation|émission|emission|d'?émission)?")
    if not invoice_date:
        invoice_date = _find_date(text, r"\bdate\b")
    if invoice_date:
        draft["invoice"]["invoice_date"] = invoice_date
        confidence["invoice_date"] = 0.6

    due_date = _find_date(text, r"(?:date\s*(?:d'?)?[ée]ch[ée]ance|[ée]ch[ée]ance|date\s*limite|à\s*payer\s*avant)")
    if due_date:
        draft["invoice"]["due_date"] = due_date
        confidence["due_date"] = 0.5

    # --- Devise -------------------------------------------------------------
    if re.search(r"\b(eur|euro|euros)\b|€", text, re.IGNORECASE):
        draft["invoice"]["currency"] = "EUR"
    elif re.search(r"\b(usd|dollar)\b|\$", text, re.IGNORECASE):
        draft["invoice"]["currency"] = "USD"

    # --- SIRET (14 chiffres) ------------------------------------------------
    sirets: list[str] = []
    for match in re.finditer(r"\b(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{5})\b", text):
        cleaned = _clean_siret(match.group(1))
        if cleaned and cleaned not in sirets:
            sirets.append(cleaned)
    if sirets:
        draft["supplier"]["siret"] = sirets[0]
        confidence["supplier.siret"] = 0.6
    if len(sirets) >= 2:
        draft["customer"]["siret"] = sirets[1]
        confidence["customer.siret"] = 0.5
    else:
        warnings.append("Le SIRET client n'a pas été détecté automatiquement.")

    # --- TVA intracommunautaire fournisseur --------------------------------
    vat_match = re.search(r"\bFR\s?[0-9A-Z]{2}\s?\d{9}\b", text, re.IGNORECASE)
    if vat_match:
        draft["supplier"]["vat_number"] = re.sub(r"\s", "", vat_match.group(0)).upper()
        confidence["supplier.vat_number"] = 0.6

    # --- Noms (heuristique faible) -----------------------------------------
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if lines:
        # Le bloc d'en-tête (1re ligne « significative ») est souvent l'émetteur.
        first_meaningful = next((l for l in lines if len(l) > 2 and not l.isdigit()), None)
        if first_meaningful and len(first_meaningful) <= 80:
            draft["supplier"]["name"] = first_meaningful
            confidence["supplier.name"] = 0.4
    customer_name = None
    for keyword in (r"client", r"destinataire", r"factur[ée]\s*[àa]", r"adress[ée]\s*[àa]"):
        match = re.search(keyword + r"\s*[:\-]?\s*([^\n]{2,80})", text, re.IGNORECASE)
        if match:
            customer_name = match.group(1).strip()
            break
    if customer_name:
        draft["customer"]["name"] = customer_name
        confidence["customer.name"] = 0.35

    # --- Totaux -------------------------------------------------------------
    total_ht = _first_amount(text, [
        rf"\btotal\s*ht\s*[:#\-]?\s*{AMOUNT_PATTERN}",
        rf"\bmontant\s*ht\s*[:#\-]?\s*{AMOUNT_PATTERN}",
        rf"\bhors\s*taxes?\s*[:#\-]?\s*{AMOUNT_PATTERN}",
    ])
    total_tva = _first_amount(text, [
        rf"\b(?:montant\s*tva|total\s*tva|tva)\s*[:#\-]?\s*{AMOUNT_PATTERN}",
        rf"\btva\s*[0-9]{{1,2}}(?:[,.][0-9]+)?\s*%\s*[:#\-]?\s*{AMOUNT_PATTERN}",
    ])
    total_ttc = _first_amount(text, [
        rf"\btotal\s*ttc\s*[:#\-]?\s*{AMOUNT_PATTERN}",
        rf"\bmontant\s*ttc\s*[:#\-]?\s*{AMOUNT_PATTERN}",
        rf"\b(?:net\s*[àa]\s*payer)\s*[:#\-]?\s*{AMOUNT_PATTERN}",
    ])
    # Reconstitution si une seule valeur manque.
    if total_ht is None and total_ttc is not None and total_tva is not None:
        total_ht = total_ttc - total_tva
    if total_ttc is None and total_ht is not None and total_tva is not None:
        total_ttc = total_ht + total_tva

    draft["invoice"]["total_ht"] = _amount_to_float(total_ht)
    draft["invoice"]["total_tva"] = _amount_to_float(total_tva)
    draft["invoice"]["total_ttc"] = _amount_to_float(total_ttc)
    if total_ht is not None:
        confidence["total_ht"] = 0.7
    if total_tva is not None:
        confidence["total_tva"] = 0.7
    if total_ttc is not None:
        confidence["total_ttc"] = 0.8

    vat_rate = _extract_vat_rate(text)
    vat_rate_float = float(vat_rate) if vat_rate else None

    # --- Ventilation TVA ----------------------------------------------------
    if total_tva is not None and total_ht is not None:
        draft["vat_breakdown"] = [{
            "vat_rate": vat_rate_float,
            "base_amount": _amount_to_float(total_ht),
            "vat_amount": _amount_to_float(total_tva),
        }]

    # --- Lignes (fallback ligne unique) ------------------------------------
    if total_ht is not None:
        draft["lines"] = [{
            "description": FALLBACK_LINE_DESCRIPTION,
            "quantity": 1,
            "unit_price": _amount_to_float(total_ht),
            "vat_rate": vat_rate_float,
            "line_total_ht": _amount_to_float(total_ht),
        }]
        warnings.append(
            "Les lignes n'ont pas pu être détaillées : une ligne unique de repli a été créée. "
            "Ajustez si nécessaire."
        )
    else:
        warnings.append("Aucun total HT détecté : complétez les montants avant de générer le XML.")

    # --- Avertissements génériques -----------------------------------------
    if draft["customer"]["service_code"] is None:
        warnings.append("Le code service destinataire est manquant et peut être requis pour certains destinataires.")
    if not invoice_number:
        warnings.append("Le numéro de facture n'a pas été détecté : saisissez-le manuellement.")
    if not invoice_date:
        warnings.append("La date de facture n'a pas été détectée : saisissez-la au format AAAA-MM-JJ.")

    return {"draft": draft, "confidence": confidence, "warnings": warnings}
