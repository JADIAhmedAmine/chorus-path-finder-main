"""Conversion d'un brouillon de facture (extraction PDF) -> JSON Iopole.

Chaîne « n'importe quel PDF -> e-facture conforme » :
  PDF -> ``chorus_pdf_invoice_extractor.extract_invoice_draft`` (texte + heuristique/LLM)
      -> ``map_draft_to_iopole_json`` (ce module)
      -> ``/v1/tools/{facturx|ubl|cii}/generate`` (Iopole génère un flux conforme)
      -> dépôt.

L'extraction est best-effort : **relecture/correction humaine recommandée** avant
génération. Le mapping reste tolérant (champs manquants -> omis ou valeurs neutres).
"""

from __future__ import annotations

import re
from typing import Any


def _digits(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\D", "", value)
    return cleaned or None


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(" ", "").replace(",", "."))
        except ValueError:
            return None
    return None


def _party(data: dict[str, Any]) -> dict[str, Any]:
    siret = _digits(data.get("siret"))
    siren = siret[:9] if siret and len(siret) >= 9 else None
    party: dict[str, Any] = {"name": data.get("name") or ""}
    if siren:
        party["siren"] = siren
        party["electronicAddress"] = f"0225:{siren}"  # schéma FRCTC adresse électronique
    vat = data.get("vat_number")
    if isinstance(vat, str) and vat.strip():
        party["vatNumber"] = re.sub(r"\s", "", vat).upper()
    address: dict[str, Any] = {"country": "FR"}
    if isinstance(data.get("address"), str) and data["address"].strip():
        address["addressLineOne"] = data["address"].strip()
    party["postalAddress"] = address
    return party


def map_draft_to_iopole_json(draft: dict[str, Any]) -> dict[str, Any]:
    """Transforme le ``draft`` (cf. ``chorus_pdf_invoice_extractor.empty_draft``)
    en modèle JSON Iopole prêt pour ``/v1/tools/*/generate``."""
    supplier = draft.get("supplier") if isinstance(draft.get("supplier"), dict) else {}
    customer = draft.get("customer") if isinstance(draft.get("customer"), dict) else {}
    invoice = draft.get("invoice") if isinstance(draft.get("invoice"), dict) else {}
    lines = draft.get("lines") if isinstance(draft.get("lines"), list) else []
    vat_breakdown = draft.get("vat_breakdown") if isinstance(draft.get("vat_breakdown"), list) else []

    currency = (invoice.get("currency") or "EUR") if isinstance(invoice.get("currency"), str) else "EUR"

    out: dict[str, Any] = {
        "type": 380,
        "processType": "B1",
        "invoiceId": invoice.get("invoice_number") or "",
        "invoiceDate": invoice.get("invoice_date") or "",
        "taxPaymentOption": {"code": 5},
        "seller": _party(supplier),
        "buyer": _party(customer),
    }
    if invoice.get("due_date"):
        out["invoiceDueDate"] = invoice["due_date"]

    out_lines: list[dict[str, Any]] = []
    for index, line in enumerate(lines, start=1):
        if not isinstance(line, dict):
            continue
        rate = _num(line.get("vat_rate"))
        out_lines.append({
            "id": str(index),
            "item": {"name": line.get("description") or "Article"},
            "billedQuantity": {"unitCode": "EA", "quantity": _num(line.get("quantity")) or 1},
            "totalAmount": {"amount": _num(line.get("line_total_ht")) or 0, "currency": currency},
            "taxDetail": {"taxType": "VAT", "categoryCode": "S", "percent": rate if rate is not None else 20},
            "price": {"netAmount": {"amount": _num(line.get("unit_price")) or 0, "currency": currency}},
        })
    if out_lines:
        out["lines"] = out_lines

    tax_details: list[dict[str, Any]] = []
    for entry in vat_breakdown:
        if not isinstance(entry, dict):
            continue
        rate = _num(entry.get("vat_rate"))
        tax_details.append({
            "taxableAmount": {"amount": _num(entry.get("base_amount")) or 0, "currency": currency},
            "taxAmount": {"amount": _num(entry.get("vat_amount")) or 0, "currency": currency},
            "taxType": "VAT",
            "categoryCode": "S",
            "percent": rate if rate is not None else 20,
        })
    if tax_details:
        out["taxDetails"] = tax_details

    ht = _num(invoice.get("total_ht")) or 0
    tva = _num(invoice.get("total_tva")) or 0
    ttc = _num(invoice.get("total_ttc")) or (ht + tva)
    out["monetary"] = {
        "invoiceAmount": {"amount": ttc, "currency": currency},
        "taxBasisTotalAmount": {"amount": ht, "currency": currency},
        "taxTotalAmount": {"amount": tva, "currency": currency},
        "payableAmount": {"amount": ttc, "currency": currency},
        "lineTotalAmount": {"amount": ht, "currency": currency},
        "invoiceCurrency": currency,
    }
    return out
