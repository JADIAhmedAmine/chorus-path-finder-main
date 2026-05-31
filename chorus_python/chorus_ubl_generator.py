"""Génération d'un XML UBL Invoice à partir d'un brouillon validé.

Cible v1 : ``IN_DP_E1_STRUCT`` / ``IN_DP_E1_UBL_INVOICE``.

Le XML est construit avec ``xml.etree.ElementTree`` (pas de concaténation de
chaînes) : tout le texte est donc échappé automatiquement. Structure UBL
volontairement minimale mais conforme dans son squelette (racine ``Invoice`` du
namespace UBL Invoice-2, préfixes ``cac``/``cbc``).

NOTE Chorus : certains champs spécifiques (code service destinataire, numéro
d'engagement, cadre de facturation) ne sont pas encore mappés dans le profil UBL
ci-dessous — voir les TODO. Ils restent disponibles dans le brouillon pour un
mapping ultérieur.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
CAC_NS = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
CBC_NS = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"

# Profil EN 16931 générique (TODO: figer la CIUS/CustomizationID attendue par Chorus FR).
CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017"
PROFILE_ID = "urn:fdc:chorus-pro.gouv.fr:flux:depot"
INVOICE_TYPE_CODE = "380"  # facture commerciale
DEFAULT_CURRENCY = "EUR"

GENERATED_FILENAME = "generated_invoice_ubl.xml"


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def _sub(parent: ET.Element, ns: str, tag: str, text: Any = None, attrib: dict[str, str] | None = None) -> ET.Element:
    element = ET.SubElement(parent, _q(ns, tag), attrib or {})
    if text is not None:
        element.text = str(text)
    return element


def _to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
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


def _money(value: Any) -> str:
    amount = _to_float(value) or 0.0
    return f"{amount:.2f}"


def _rate(value: Any) -> str:
    rate = _to_float(value)
    return f"{rate:.2f}" if rate is not None else "0.00"


def _digits(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s", "", value)
    return cleaned or None


def _str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _party(parent: ET.Element, wrapper_tag: str, data: dict[str, Any], currency: str) -> None:
    wrapper = _sub(parent, CAC_NS, wrapper_tag)
    party = _sub(wrapper, CAC_NS, "Party")

    name = _str(data.get("name"))
    if name:
        party_name = _sub(party, CAC_NS, "PartyName")
        _sub(party_name, CBC_NS, "Name", name)

    address = _str(data.get("address"))
    postal = _sub(party, CAC_NS, "PostalAddress")
    if address:
        _sub(postal, CBC_NS, "StreetName", address)
    country = _sub(postal, CAC_NS, "Country")
    _sub(country, CBC_NS, "IdentificationCode", "FR")  # TODO: déduire le pays si disponible

    vat_number = _str(data.get("vat_number"))
    if vat_number:
        tax_scheme_party = _sub(party, CAC_NS, "PartyTaxScheme")
        _sub(tax_scheme_party, CBC_NS, "CompanyID", re.sub(r"\s", "", vat_number))
        scheme = _sub(tax_scheme_party, CAC_NS, "TaxScheme")
        _sub(scheme, CBC_NS, "ID", "VAT")

    legal_entity = _sub(party, CAC_NS, "PartyLegalEntity")
    _sub(legal_entity, CBC_NS, "RegistrationName", name or "—")
    siret = _digits(data.get("siret"))
    if siret:
        # schemeID 0009 = SIRET (norme ISO 6523).
        _sub(legal_entity, CBC_NS, "CompanyID", siret, {"schemeID": "0009"})


def _resolve_lines(draft: dict[str, Any], total_ht: float | None, vat_rate: float | None) -> list[dict[str, Any]]:
    lines = draft.get("lines")
    resolved: list[dict[str, Any]] = []
    if isinstance(lines, list):
        for line in lines:
            if isinstance(line, dict) and _to_float(line.get("line_total_ht")) is not None:
                resolved.append(line)
    if resolved:
        return resolved
    # Ligne de repli unique alignée sur le total HT.
    return [{
        "description": "Prestation / Produit extrait de la facture PDF",
        "quantity": 1,
        "unit_price": total_ht,
        "vat_rate": vat_rate,
        "line_total_ht": total_ht,
    }]


def generate_ubl_invoice(draft: dict[str, Any]) -> str:
    """Construit et retourne le XML UBL Invoice (chaîne, avec déclaration XML)."""
    supplier = draft.get("supplier") if isinstance(draft.get("supplier"), dict) else {}
    customer = draft.get("customer") if isinstance(draft.get("customer"), dict) else {}
    invoice = draft.get("invoice") if isinstance(draft.get("invoice"), dict) else {}
    vat_breakdown = draft.get("vat_breakdown") if isinstance(draft.get("vat_breakdown"), list) else []

    currency = _str(invoice.get("currency")) or DEFAULT_CURRENCY
    total_ht = _to_float(invoice.get("total_ht"))
    total_tva = _to_float(invoice.get("total_tva"))
    total_ttc = _to_float(invoice.get("total_ttc"))

    primary_rate = None
    if vat_breakdown and isinstance(vat_breakdown[0], dict):
        primary_rate = _to_float(vat_breakdown[0].get("vat_rate"))

    ET.register_namespace("", INVOICE_NS)
    ET.register_namespace("cac", CAC_NS)
    ET.register_namespace("cbc", CBC_NS)

    root = ET.Element(_q(INVOICE_NS, "Invoice"))
    root.append(ET.Comment(
        " Généré depuis un PDF après validation humaine. "
        "TODO Chorus: mapper code service destinataire, numéro d'engagement et cadre de facturation. "
    ))

    cur_attr = {"currencyID": currency}

    _sub(root, CBC_NS, "CustomizationID", CUSTOMIZATION_ID)
    _sub(root, CBC_NS, "ProfileID", PROFILE_ID)
    _sub(root, CBC_NS, "ID", _str(invoice.get("invoice_number")) or "SANS-NUMERO")
    _sub(root, CBC_NS, "IssueDate", _str(invoice.get("invoice_date")) or "")
    due_date = _str(invoice.get("due_date"))
    if due_date:
        _sub(root, CBC_NS, "DueDate", due_date)
    _sub(root, CBC_NS, "InvoiceTypeCode", INVOICE_TYPE_CODE)
    payment_terms = _str(invoice.get("payment_terms"))
    if payment_terms:
        _sub(root, CBC_NS, "Note", payment_terms)
    _sub(root, CBC_NS, "DocumentCurrencyCode", currency)

    # TODO Chorus: BuyerReference / OrderReference pour le numéro d'engagement.
    engagement = _str(customer.get("engagement_number")) or _str(
        (draft.get("chorus") or {}).get("engagement_number") if isinstance(draft.get("chorus"), dict) else None
    )
    if engagement:
        _sub(root, CBC_NS, "BuyerReference", engagement)

    _party(root, "AccountingSupplierParty", supplier, currency)
    _party(root, "AccountingCustomerParty", customer, currency)

    # --- TaxTotal -----------------------------------------------------------
    tax_total = _sub(root, CAC_NS, "TaxTotal")
    _sub(tax_total, CBC_NS, "TaxAmount", _money(total_tva), cur_attr)
    subtotals = vat_breakdown if vat_breakdown else [{
        "vat_rate": primary_rate,
        "base_amount": total_ht,
        "vat_amount": total_tva,
    }]
    for entry in subtotals:
        if not isinstance(entry, dict):
            continue
        subtotal = _sub(tax_total, CAC_NS, "TaxSubtotal")
        _sub(subtotal, CBC_NS, "TaxableAmount", _money(entry.get("base_amount")), cur_attr)
        _sub(subtotal, CBC_NS, "TaxAmount", _money(entry.get("vat_amount")), cur_attr)
        category = _sub(subtotal, CAC_NS, "TaxCategory")
        _sub(category, CBC_NS, "ID", "S")
        _sub(category, CBC_NS, "Percent", _rate(entry.get("vat_rate")))
        scheme = _sub(category, CAC_NS, "TaxScheme")
        _sub(scheme, CBC_NS, "ID", "VAT")

    # --- LegalMonetaryTotal -------------------------------------------------
    monetary = _sub(root, CAC_NS, "LegalMonetaryTotal")
    _sub(monetary, CBC_NS, "LineExtensionAmount", _money(total_ht), cur_attr)
    _sub(monetary, CBC_NS, "TaxExclusiveAmount", _money(total_ht), cur_attr)
    _sub(monetary, CBC_NS, "TaxInclusiveAmount", _money(total_ttc), cur_attr)
    _sub(monetary, CBC_NS, "PayableAmount", _money(total_ttc), cur_attr)

    # --- InvoiceLine(s) -----------------------------------------------------
    for index, line in enumerate(_resolve_lines(draft, total_ht, primary_rate), start=1):
        invoice_line = _sub(root, CAC_NS, "InvoiceLine")
        _sub(invoice_line, CBC_NS, "ID", str(index))
        quantity = _to_float(line.get("quantity"))
        _sub(invoice_line, CBC_NS, "InvoicedQuantity", f"{quantity:g}" if quantity is not None else "1", {"unitCode": "C62"})
        _sub(invoice_line, CBC_NS, "LineExtensionAmount", _money(line.get("line_total_ht")), cur_attr)
        item = _sub(invoice_line, CAC_NS, "Item")
        _sub(item, CBC_NS, "Name", _str(line.get("description")) or "Article")
        category = _sub(item, CAC_NS, "ClassifiedTaxCategory")
        _sub(category, CBC_NS, "ID", "S")
        _sub(category, CBC_NS, "Percent", _rate(line.get("vat_rate") if line.get("vat_rate") is not None else primary_rate))
        scheme = _sub(category, CAC_NS, "TaxScheme")
        _sub(scheme, CBC_NS, "ID", "VAT")
        price = _sub(invoice_line, CAC_NS, "Price")
        _sub(price, CBC_NS, "PriceAmount", _money(line.get("unit_price")), cur_attr)

    try:
        ET.indent(root, space="  ")  # Python ≥ 3.9
    except AttributeError:  # pragma: no cover - vieux runtimes
        pass

    body = ET.tostring(root, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + body
