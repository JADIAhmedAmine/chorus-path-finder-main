from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from .models import ChorusMinimalInvoiceInput, InvoiceLineInput


MONEY_QUANTIZER = Decimal("0.0001")

DEFAULT_CODE_CADRE_FACTURATION = "A1_FACTURE_FOURNISSEUR"
DEFAULT_MODE_DEPOT = "DEPOT_PDF_API"
SIGNED_PDF_MODE_DEPOT = "DEPOT_PDF_SIGNE_API"
DEFAULT_DEVISE_FACTURE = "EUR"
DEFAULT_MODE_PAIEMENT = "VIREMENT"
DEFAULT_TYPE_FACTURE = "FACTURE"
DEFAULT_TYPE_TVA = "TVA_SUR_DEBIT"
DEFAULT_PIECE_JOINTE_PRINCIPALE_DESIGNATION = "GCU_MSG_01_000"


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None

    trimmed = value.strip()
    return trimmed or None


def _to_decimal(value: Decimal | str | float | int | None, default: Decimal = Decimal("0")) -> Decimal:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _quantize_amount(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANTIZER, rounding=ROUND_HALF_UP)


def _json_number(value: Decimal) -> int | float:
    quantized = _quantize_amount(value)
    if quantized == quantized.to_integral_value():
        return int(quantized)
    return float(quantized)


def _format_invoice_date(value: date | str | None) -> str:
    if value is None:
        raise ValueError("dateFacture manquante.")

    if isinstance(value, date):
        return value.isoformat()

    trimmed = value.strip()
    if not trimmed:
        raise ValueError("dateFacture manquante.")

    try:
        return datetime.fromisoformat(trimmed).date().isoformat()
    except ValueError:
        return trimmed


def _line_total_ht(line: InvoiceLineInput) -> Decimal:
    return _quantize_amount((line.unit_price_decimal * line.quantity_decimal) - line.discount_decimal)


def _line_tva_amount(line_total_ht: Decimal, vat_rate_percent: Decimal) -> Decimal:
    return _quantize_amount(line_total_ht * vat_rate_percent / Decimal("100"))


@dataclass(slots=True)
class SoumissionFacture:
    numero_facture_saisi: str
    date_facture: date | str
    code_destinataire: str
    id_fournisseur: int
    piece_jointe_principale_id: int
    ligne_poste: list[InvoiceLineInput] = field(default_factory=list)
    piece_jointe_principale_designation: str = DEFAULT_PIECE_JOINTE_PRINCIPALE_DESIGNATION
    code_cadre_facturation: str = DEFAULT_CODE_CADRE_FACTURATION
    mode_depot: str = DEFAULT_MODE_DEPOT
    devise_facture: str = DEFAULT_DEVISE_FACTURE
    mode_paiement: str = DEFAULT_MODE_PAIEMENT
    type_facture: str = DEFAULT_TYPE_FACTURE
    type_tva: str = DEFAULT_TYPE_TVA
    montant_remise_globale_ttc: Decimal | str | float | int = 0
    montant_ht_total: Decimal = field(init=False)
    montant_tva: Decimal = field(init=False)
    montant_ttc_total: Decimal = field(init=False)
    montant_a_payer: Decimal = field(init=False)

    def __post_init__(self) -> None:
        numero_facture = _normalize_text(self.numero_facture_saisi)
        if not numero_facture:
            raise ValueError("numeroFactureSaisi manquant.")
        self.numero_facture_saisi = numero_facture

        self.date_facture = _format_invoice_date(self.date_facture)

        code_destinataire = _normalize_text(self.code_destinataire)
        if not code_destinataire:
            raise ValueError("codeDestinataire manquant.")
        self.code_destinataire = code_destinataire

        try:
            self.id_fournisseur = int(self.id_fournisseur)
        except (TypeError, ValueError) as error:
            raise ValueError("idFournisseur invalide.") from error
        if self.id_fournisseur <= 0:
            raise ValueError("idFournisseur doit être positif.")

        try:
            self.piece_jointe_principale_id = int(self.piece_jointe_principale_id)
        except (TypeError, ValueError) as error:
            raise ValueError("pieceJointePrincipaleId invalide.") from error
        if self.piece_jointe_principale_id <= 0:
            raise ValueError("pieceJointePrincipaleId doit être positif.")

        designation = _normalize_text(self.piece_jointe_principale_designation)
        self.piece_jointe_principale_designation = designation or DEFAULT_PIECE_JOINTE_PRINCIPALE_DESIGNATION

        self.code_cadre_facturation = _normalize_text(self.code_cadre_facturation) or DEFAULT_CODE_CADRE_FACTURATION
        self.mode_depot = _normalize_text(self.mode_depot) or DEFAULT_MODE_DEPOT
        self.devise_facture = _normalize_text(self.devise_facture) or DEFAULT_DEVISE_FACTURE
        self.mode_paiement = _normalize_text(self.mode_paiement) or DEFAULT_MODE_PAIEMENT
        self.type_facture = _normalize_text(self.type_facture) or DEFAULT_TYPE_FACTURE
        self.type_tva = _normalize_text(self.type_tva) or DEFAULT_TYPE_TVA
        self.montant_remise_globale_ttc = _to_decimal(self.montant_remise_globale_ttc)

        if not self.ligne_poste:
            raise ValueError("Au moins une ligne de poste est requise pour construire SoumissionFacture.")

        self.ligne_poste = list(self.ligne_poste)
        self.montant_ht_total, self.montant_tva, self.montant_ttc_total = self._compute_totals()
        self.montant_a_payer = self.montant_ttc_total

    @classmethod
    def from_invoice(
        cls,
        invoice: ChorusMinimalInvoiceInput,
        *,
        code_destinataire: str,
        id_fournisseur: int,
        piece_jointe_principale_id: int,
        piece_jointe_principale_designation: str | None = None,
        mode_depot: str | None = None,
    ) -> SoumissionFacture:
        return cls(
            numero_facture_saisi=invoice.invoice_number,
            date_facture=invoice.invoice_date,
            code_destinataire=code_destinataire,
            id_fournisseur=id_fournisseur,
            piece_jointe_principale_id=piece_jointe_principale_id,
            ligne_poste=list(invoice.lines),
            piece_jointe_principale_designation=(
                piece_jointe_principale_designation or DEFAULT_PIECE_JOINTE_PRINCIPALE_DESIGNATION
            ),
            mode_depot=mode_depot or DEFAULT_MODE_DEPOT,
        )

    def _compute_totals(self) -> tuple[Decimal, Decimal, Decimal]:
        montant_ht_total = Decimal("0")
        montant_tva_total = Decimal("0")

        for line in self.ligne_poste:
            line_total_ht = _line_total_ht(line)
            line_tva = _line_tva_amount(line_total_ht, line.vat_rate_decimal)
            montant_ht_total += line_total_ht
            montant_tva_total += line_tva

        montant_ht_total = _quantize_amount(montant_ht_total)
        montant_tva_total = _quantize_amount(montant_tva_total)
        montant_ttc_total = _quantize_amount(montant_ht_total + montant_tva_total)
        return montant_ht_total, montant_tva_total, montant_ttc_total

    def _build_ligne_poste_payload(self) -> list[dict[str, Any]]:
        ligne_poste_payload: list[dict[str, Any]] = []
        for index, line in enumerate(self.ligne_poste, start=1):
            ligne_poste_payload.append(
                {
                    "lignePosteDenomination": _normalize_text(line.description) or f"Ligne {index}",
                    "lignePosteMontantRemiseHT": _json_number(line.discount_decimal),
                    "lignePosteMontantUnitaireHT": _json_number(line.unit_price_decimal),
                    "lignePosteNumero": index,
                    "lignePosteQuantite": _json_number(line.quantity_decimal),
                    "lignePosteReference": _normalize_text(line.reference) or "",
                    "lignePosteTauxTvaManuel": _json_number(line.vat_rate_decimal),
                    "lignePosteUnite": _normalize_text(line.unit) or "UNITE",
                }
            )

        return ligne_poste_payload

    def _build_ligne_tva_payload(self) -> list[dict[str, Any]]:
        grouped_ligne_tva: dict[Decimal, dict[str, Decimal]] = {}

        for line in self.ligne_poste:
            line_total_ht = _line_total_ht(line)
            vat_rate = _quantize_amount(line.vat_rate_decimal)
            line_tva = _line_tva_amount(line_total_ht, vat_rate)
            group = grouped_ligne_tva.setdefault(
                vat_rate,
                {
                    "base_ht": Decimal("0"),
                    "montant_tva": Decimal("0"),
                },
            )
            group["base_ht"] += line_total_ht
            group["montant_tva"] += line_tva

        return [
            {
                "ligneTvaMontantBaseHtParTaux": _json_number(values["base_ht"]),
                "ligneTvaMontantTvaParTaux": _json_number(values["montant_tva"]),
                "ligneTvaTauxManuel": _json_number(rate),
            }
            for rate, values in grouped_ligne_tva.items()
        ]

    def to_payload(self) -> dict[str, Any]:
        return {
            "numeroFactureSaisi": self.numero_facture_saisi,
            "dateFacture": self.date_facture,
            "cadreDeFacturation": {
                "codeCadreFacturation": self.code_cadre_facturation,
            },
            "destinataire": {
                "codeDestinataire": self.code_destinataire,
            },
            "fournisseur": {
                "idFournisseur": self.id_fournisseur,
            },
            "lignePoste": self._build_ligne_poste_payload(),
            "ligneTva": self._build_ligne_tva_payload(),
            "modeDepot": self.mode_depot,
            "montantTotal": {
                "montantAPayer": _json_number(self.montant_a_payer),
                "montantHtTotal": _json_number(self.montant_ht_total),
                "montantRemiseGlobaleTTC": _json_number(self.montant_remise_globale_ttc),
                "montantTVA": _json_number(self.montant_tva),
                "montantTtcTotal": _json_number(self.montant_ttc_total),
            },
            "pieceJointePrincipale": [
                {
                    "pieceJointePrincipaleDesignation": self.piece_jointe_principale_designation,
                    "pieceJointePrincipaleId": self.piece_jointe_principale_id,
                }
            ],
            "references": {
                "deviseFacture": self.devise_facture,
                "modePaiement": self.mode_paiement,
                "typeFacture": self.type_facture,
                "typeTva": self.type_tva,
            },
        }
