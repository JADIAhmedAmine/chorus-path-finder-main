"""Service « PDF facture → flux » : détection PDF + validation du brouillon.

Aucune logique de dépôt ici (réutilisation du module flux existant côté routes).
Garde-fou produit : un PDF normal NE PEUT PAS être déposé directement ; il doit
passer par extraction → relecture humaine → génération XML → validation → dépôt.
"""

from __future__ import annotations

import re
from typing import Any

from .chorus_flux_detector import (
    FACTURX_CII,
    PDF_GENERIC,
    detect_flux_file,
)

# Tolérance de cohérence des montants (centimes d'arrondi).
AMOUNT_TOLERANCE = 0.02

MSG_FACTURX = "Ce PDF est déjà un Factur-X. Il peut être déposé directement comme flux Factur-X."
MSG_PDF_GENERIC = (
    "Ce PDF ne contient pas de XML Factur-X embarqué. Une conversion en flux structuré est nécessaire."
)

# Syntaxes Factur-X recommandées (indicatif ; la source de vérité reste l'API Chorus).
FACTURX_FORMAT_TARGETS = ("IN_DP_E2_FACTURX_FE", "IN_DP_E2_FACTURX")
FACTURX_SYNTAXE_TARGETS = ("IN_DP_E2_CII_FACTURX_FE", "IN_DP_E2_CII_FACTURX")


def _looks_like_pdf(file_bytes: bytes, filename: str) -> bool:
    return (filename or "").lower().endswith(".pdf") or file_bytes[:5] == b"%PDF-"


def detect_pdf_for_flux(file_bytes: bytes, filename: str) -> dict[str, Any]:
    """Détecte si un PDF est un Factur-X (dépôt direct) ou un PDF normal (conversion).

    Lève ``ValueError`` si le fichier n'est pas un PDF exploitable.
    """
    if not file_bytes:
        raise ValueError("Le fichier est vide.")
    if not _looks_like_pdf(file_bytes, filename):
        raise ValueError("Seuls les fichiers PDF sont acceptés sur « PDF facture → flux ».")

    detected = detect_flux_file(file_bytes, filename)
    pdf_type = detected.get("detected_file_type")
    is_facturx = pdf_type == FACTURX_CII

    result: dict[str, Any] = {
        "success": True,
        "filename": filename,
        "pdf_type": pdf_type,
        "is_facturx": is_facturx,
        "direct_deposit_possible": is_facturx,
        "conversion_required": not is_facturx,
        "embedded_xml_filename": detected.get("embedded_xml_filename"),
        "embedded_xml_root": detected.get("embedded_xml_root"),
        "message": MSG_FACTURX if is_facturx else MSG_PDF_GENERIC,
    }
    if is_facturx:
        result["recommended"] = {
            "formatFlux": list(FACTURX_FORMAT_TARGETS),
            "syntaxeFlux": list(FACTURX_SYNTAXE_TARGETS),
        }
    elif pdf_type != PDF_GENERIC:
        # PDF lisible mais ni Factur-X ni « générique » classique : on reste prudent.
        result["pdf_type"] = PDF_GENERIC
        result["conversion_required"] = True
    return result


# ---------------------------------------------------------------------------
# Validation du brouillon avant génération XML
# ---------------------------------------------------------------------------
SIRET_RE = re.compile(r"^\d{14}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(" ", "").replace(",", ".")
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _approx_equal(a: float | None, b: float | None, tol: float = AMOUNT_TOLERANCE) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= tol


def _section(draft: dict[str, Any], key: str) -> dict[str, Any]:
    value = draft.get(key)
    return value if isinstance(value, dict) else {}


def _str_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def validate_draft(draft: dict[str, Any]) -> dict[str, Any]:
    """Valide les champs requis + la cohérence numérique du brouillon.

    Retourne ``{success, valid, errors[], warnings[]}`` ; ``errors`` bloque la
    génération XML, ``warnings`` est informatif.
    """
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    if not isinstance(draft, dict):
        return {
            "success": True,
            "valid": False,
            "errors": [{"field": "draft", "message": "Brouillon invalide."}],
            "warnings": [],
        }

    supplier = _section(draft, "supplier")
    customer = _section(draft, "customer")
    invoice = _section(draft, "invoice")
    chorus = _section(draft, "chorus")
    lines = draft.get("lines") if isinstance(draft.get("lines"), list) else []
    vat_breakdown = draft.get("vat_breakdown") if isinstance(draft.get("vat_breakdown"), list) else []

    def require(condition: bool, field: str, message: str) -> None:
        if not condition:
            errors.append({"field": field, "message": message})

    # --- Champs obligatoires -----------------------------------------------
    require(bool(_str_or_none(supplier.get("name"))), "supplier.name", "Le nom du fournisseur est obligatoire.")
    require(
        bool(_str_or_none(supplier.get("siret")) or _str_or_none(supplier.get("vat_number"))),
        "supplier.siret",
        "Le SIRET ou le numéro de TVA du fournisseur est obligatoire.",
    )
    require(bool(_str_or_none(customer.get("name"))), "customer.name", "Le nom du client est obligatoire.")
    require(bool(_str_or_none(customer.get("siret"))), "customer.siret", "Le SIRET client est obligatoire.")
    require(bool(_str_or_none(invoice.get("invoice_number"))), "invoice.invoice_number", "Le numéro de facture est obligatoire.")
    require(bool(_str_or_none(invoice.get("invoice_date"))), "invoice.invoice_date", "La date de facture est obligatoire.")

    currency = _str_or_none(invoice.get("currency")) or "EUR"

    total_ht = _to_float(invoice.get("total_ht"))
    total_tva = _to_float(invoice.get("total_tva"))
    total_ttc = _to_float(invoice.get("total_ttc"))
    require(total_ht is not None, "invoice.total_ht", "Le total HT est obligatoire.")
    require(total_tva is not None, "invoice.total_tva", "Le total TVA est obligatoire.")
    require(total_ttc is not None, "invoice.total_ttc", "Le total TTC est obligatoire.")

    # --- Formats ------------------------------------------------------------
    supplier_siret = _str_or_none(supplier.get("siret"))
    if supplier_siret and not SIRET_RE.match(re.sub(r"\s", "", supplier_siret)):
        errors.append({"field": "supplier.siret", "message": "Le SIRET fournisseur doit comporter 14 chiffres."})
    customer_siret = _str_or_none(customer.get("siret"))
    if customer_siret and not SIRET_RE.match(re.sub(r"\s", "", customer_siret)):
        errors.append({"field": "customer.siret", "message": "Le SIRET client doit comporter 14 chiffres."})

    invoice_date = _str_or_none(invoice.get("invoice_date"))
    if invoice_date and not DATE_RE.match(invoice_date):
        errors.append({"field": "invoice.invoice_date", "message": "La date de facture doit être au format AAAA-MM-JJ."})
    due_date = _str_or_none(invoice.get("due_date"))
    if due_date and not DATE_RE.match(due_date):
        errors.append({"field": "invoice.due_date", "message": "La date d'échéance doit être au format AAAA-MM-JJ."})

    # --- Montants négatifs --------------------------------------------------
    for field, amount in (("invoice.total_ht", total_ht), ("invoice.total_tva", total_tva), ("invoice.total_ttc", total_ttc)):
        if amount is not None and amount < 0:
            errors.append({"field": field, "message": "Les montants négatifs (avoirs) ne sont pas pris en charge dans cette version."})

    # --- Lignes -------------------------------------------------------------
    if not lines:
        warnings.append({"field": "lines", "message": "Aucune ligne : une ligne de repli sera utilisée à la génération."})

    # --- Cohérence numérique -----------------------------------------------
    if total_ht is not None and total_tva is not None and total_ttc is not None:
        if not _approx_equal(total_ht + total_tva, total_ttc):
            errors.append({
                "field": "invoice.total_ttc",
                "message": "Incohérence : total HT + total TVA ne correspond pas au total TTC.",
            })

    if lines and total_ht is not None:
        lines_sum = sum((_to_float(line.get("line_total_ht")) or 0.0) for line in lines if isinstance(line, dict))
        if not _approx_equal(lines_sum, total_ht):
            warnings.append({
                "field": "lines",
                "message": "La somme des lignes (HT) ne correspond pas exactement au total HT.",
            })

    if vat_breakdown and total_tva is not None:
        vat_sum = sum((_to_float(entry.get("vat_amount")) or 0.0) for entry in vat_breakdown if isinstance(entry, dict))
        if not _approx_equal(vat_sum, total_tva):
            warnings.append({
                "field": "vat_breakdown",
                "message": "La somme de la ventilation TVA ne correspond pas exactement au total TVA.",
            })
    elif not vat_breakdown and total_tva is not None and total_tva > 0:
        warnings.append({
            "field": "vat_breakdown",
            "message": "Aucune ventilation TVA fournie : le total TVA sera utilisé tel quel.",
        })

    # --- Champs Chorus indicatifs ------------------------------------------
    if not _str_or_none(chorus.get("service_code")) and not _str_or_none(customer.get("service_code")):
        warnings.append({"field": "chorus.service_code", "message": "Le code service peut être requis pour ce destinataire."})
    if not _str_or_none(chorus.get("engagement_number")) and not _str_or_none(customer.get("engagement_number")):
        warnings.append({"field": "chorus.engagement_number", "message": "Le numéro d'engagement peut être requis pour ce destinataire."})

    _ = currency  # documenté : EUR par défaut, déjà géré côté brouillon
    return {"success": True, "valid": len(errors) == 0, "errors": errors, "warnings": warnings}
