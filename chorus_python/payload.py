from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Mapping

from .config import ChorusFixedValues
from .models import ChorusMinimalInvoiceInput, InvoiceLineInput


MONEY_QUANTIZER = Decimal("0.01")


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANTIZER, rounding=ROUND_HALF_UP)


def as_json_number(value: Decimal) -> float:
    return float(quantize_money(value))


def format_invoice_date(value: date | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    raw_value = value.strip()
    if not raw_value:
        return None

    try:
        return datetime.fromisoformat(raw_value).date().isoformat()
    except ValueError:
        return raw_value


def compute_line_total_ht(line: InvoiceLineInput) -> Decimal:
    return quantize_money((line.unit_price_decimal * line.quantity_decimal) - line.discount_decimal)


def compute_line_tva(line_total_ht: Decimal, vat_rate_percent: Decimal) -> Decimal:
    return quantize_money(line_total_ht * vat_rate_percent / Decimal("100"))


def build_minimal_submission_payload(
    invoice: ChorusMinimalInvoiceInput,
    fixed: ChorusFixedValues,
    *,
    supplier_id: int,
    code_destinataire: str,
    code_service_executant: str | None = None,
    tva_code_by_rate: Mapping[Decimal, str],
    uploaded_piece_jointe_id: int | None = None,
    bank_account_code: int | None = None,
) -> dict[str, Any]:
    if not invoice.lines:
        raise ValueError("Au moins une ligne de facture est requise pour construire le payload Chorus.")

    ligne_poste: list[dict[str, Any]] = []
    grouped_ligne_tva: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {
            "base_ht": Decimal("0"),
            "montant_tva": Decimal("0"),
        }
    )

    montant_ht_total = Decimal("0")
    montant_tva_total = Decimal("0")

    for index, line in enumerate(invoice.lines, start=1):
        line_total_ht = compute_line_total_ht(line)
        vat_rate = line.vat_rate_decimal.normalize()
        tva_code = line.manual_tva_code or tva_code_by_rate.get(vat_rate)
        if not tva_code:
            raise ValueError(f"Aucun code TVA Chorus disponible pour le taux {vat_rate}%.")

        line_tva_amount = compute_line_tva(line_total_ht, vat_rate)
        montant_ht_total += line_total_ht
        montant_tva_total += line_tva_amount

        grouped_ligne_tva[tva_code]["base_ht"] += line_total_ht
        grouped_ligne_tva[tva_code]["montant_tva"] += line_tva_amount

        ligne_poste.append(
            {
                "lignePosteDenomination": line.description,
                "lignePosteMontantRemiseHT": as_json_number(line.discount_decimal),
                "lignePosteMontantUnitaireHT": as_json_number(line.unit_price_decimal),
                "lignePosteNumero": index,
                "lignePosteQuantite": float(line.quantity_decimal),
                "lignePosteReference": line.reference,
                "lignePosteTauxTva": tva_code,
                "lignePosteUnite": line.unit,
            }
        )

    montant_ht_total = quantize_money(montant_ht_total)
    montant_tva_total = quantize_money(montant_tva_total)
    montant_ttc_total = quantize_money(montant_ht_total + montant_tva_total)

    ligne_tva = [
        {
            "ligneTvaMontantBaseHtParTaux": as_json_number(values["base_ht"]),
            "ligneTvaMontantTvaParTaux": as_json_number(values["montant_tva"]),
            "ligneTvaTaux": code,
        }
        for code, values in grouped_ligne_tva.items()
    ]

    fournisseur: dict[str, Any] = {
        "idFournisseur": supplier_id,
    }
    if bank_account_code is not None:
        fournisseur["codeCoordonneesBancairesFournisseur"] = bank_account_code

    destinataire: dict[str, Any] = {
        "codeDestinataire": code_destinataire,
    }
    if code_service_executant:
        destinataire["codeServiceExecutant"] = code_service_executant

    payload: dict[str, Any] = {
        "cadreDeFacturation": {
            "codeCadreFacturation": fixed.code_cadre_facturation,
        },
        "destinataire": destinataire,
        "fournisseur": fournisseur,
        "lignePoste": ligne_poste,
        "ligneTva": ligne_tva,
        "modeDepot": fixed.mode_depot,
        "montantTotal": {
            "montantAPayer": as_json_number(montant_ttc_total),
            "montantHtTotal": as_json_number(montant_ht_total),
            "montantRemiseGlobaleTTC": 0,
            "montantTVA": as_json_number(montant_tva_total),
            "montantTtcTotal": as_json_number(montant_ttc_total),
            "motifRemiseGlobaleTTC": "",
        },
        "numeroFactureSaisi": invoice.invoice_number,
        "references": {
            "deviseFacture": fixed.devise_facture,
            "modePaiement": fixed.mode_paiement,
            "typeFacture": fixed.type_facture,
            "typeTva": fixed.type_tva,
        },
        "pieceJointePrincipale": [],
    }

    formatted_date = format_invoice_date(invoice.invoice_date)
    if formatted_date:
        payload["dateFacture"] = formatted_date

    if invoice.comment:
        payload["commentaire"] = invoice.comment

    if uploaded_piece_jointe_id is not None:
        designation = invoice.pdf_designation
        if not designation and invoice.pdf_path is not None:
            designation = Path(invoice.pdf_path).name
        payload["pieceJointePrincipale"] = [
            {
                "pieceJointePrincipaleDesignation": designation or "facture.pdf",
                "pieceJointePrincipaleId": uploaded_piece_jointe_id,
            }
        ]

    return payload
