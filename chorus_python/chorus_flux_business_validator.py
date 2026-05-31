"""Pré-contrôle métier d'un flux facture AVANT ``/v1/deposer/flux``.

La compatibilité « squelette/schéma » (``chorus_flux_detector``) ne suffit pas :
Chorus rejette aussi des factures techniquement valides dont les données métier
sont incomplètes/non reconnues (identifiant fournisseur non habilité, débiteur
inconnu, adresses manquantes…). Ce module extrait les champs métier (UBL et,
partiellement, CII/Factur-X) et applique des règles déterministes + une
validation pilotée par configuration/annuaire.

Sécurité : parsing XML durci (defusedxml via ``parse_xml_tree``), aucun contenu
de fichier ni secret journalisé.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

from .chorus_flux_detector import (
    CII_INVOICE,
    FACTURX_CII,
    SEVERITY_BLOCKING,
    SEVERITY_OK,
    SEVERITY_WARNING,
    UBL_INVOICE,
    _first_child,
    _first_descendant,
    _iter_descendants,
    _text_of,
    detect_flux_file,
    extract_embedded_invoice_xml,
    parse_xml_tree,
)
from .config import load_env_values

# Corrections suggérées par code d'erreur (source tracing).
_SUGGESTED_FIX: dict[str, str] = {
    "SUPPLIER_ID_MISSING": "Renseigner le SIRET fournisseur dans PartyIdentification/ID.",
    "SUPPLIER_ID_NOT_SIRET": "Utiliser un SIRET (14 chiffres) dans PartyIdentification/ID.",
    "SUPPLIER_SIRET_NOT_ALLOWED": "Configurer ce SIRET dans CHORUS_ALLOWED_SUPPLIER_SIRETS ou corriger le SIRET du XML.",
    "SUPPLIER_SIRET_NOT_CONFIGURED": "Configurer CHORUS_ALLOWED_SUPPLIER_SIRETS pour valider ce SIRET.",
    "SUPPLIER_DP_NOT_ENABLED": "Activer l'application « Demandes de paiement » pour la structure fournisseur.",
    "SUPPLIER_ADDRESS_MISSING": "Ajouter au moins une ligne d'adresse fournisseur (StreetName/CityName/PostalZone).",
    "CUSTOMER_ID_MISSING": "Renseigner le SIRET débiteur dans PartyIdentification/ID.",
    "CUSTOMER_ID_NOT_FOUND": "Vérifier que le SIRET destinataire existe dans l'annuaire Chorus.",
    "CUSTOMER_ADDRESS_MISSING": "Ajouter au moins une ligne d'adresse débiteur/client.",
    "TAX_SUBTOTAL_PERCENT_MISSING": "Ajouter <cbc:Percent>20.00</cbc:Percent> dans cac:TaxCategory.",
    "TAX_PERCENT_INVALID": "Renseigner un taux de TVA numérique compris entre 0 et 100.",
    "TAX_PERCENT_ZERO_WITH_AMOUNT": "Renseigner le taux de TVA correspondant au montant de TVA (>0).",
    "INVOICE_NUMBER_MISSING": "Renseigner le numéro de facture (cbc:ID).",
    "TOTALS_MISSING": "Renseigner les montants LegalMonetaryTotal (HT/TTC).",
    "CURRENCY_MISSING": "Renseigner cbc:DocumentCurrencyCode (ex. EUR).",
}

MSG_CII_PARTIAL = "Validation métier CII partielle — certains champs ne sont pas encore contrôlés."
MSG_ANNUAIRE_UNAVAILABLE = (
    "Validation annuaire non disponible. Impossible de confirmer que le débiteur existe dans Chorus."
)


# ---------------------------------------------------------------------------
# Configuration fournisseur (pilotée par variables d'environnement / .env)
# ---------------------------------------------------------------------------
def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on", "oui"}


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value)) if value is not None else ""


SIRET_LENGTH = 14


def _parse_id_list(env: dict[str, str], *keys: str) -> list[str]:
    """Première clé renseignée -> liste d'identifiants normalisés (chiffres)."""
    for key in keys:
        raw = env.get(key)
        if raw:
            return [d for d in (_digits(part) for part in re.split(r"[,;\s]+", raw) if part.strip()) if d]
    return []


def load_supplier_config(env: dict[str, str] | None = None) -> dict[str, Any]:
    """Lit la configuration fournisseur en distinguant SIRET et IDs internes Chorus.

    Le champ XML ``AccountingSupplierParty.Party.PartyIdentification.ID`` est un
    identifiant métier (généralement un SIRET). Il ne doit JAMAIS être comparé à
    un identifiant interne Chorus (ligne du portail).

    - SIRET autorisés : ``CHORUS_ALLOWED_SUPPLIER_SIRETS`` (repli rétro-compatible
      sur ``CHORUS_ALLOWED_SUPPLIER_IDENTIFIERS``) ;
    - IDs internes Chorus : ``CHORUS_ALLOWED_SUPPLIER_INTERNAL_IDS`` (repli sur
      l'ancien ``CHORUS_ALLOWED_SUPPLIER_IDS``) — jamais utilisés pour valider le
      champ XML PartyIdentification.ID.
    """
    env = env if env is not None else load_env_values()
    sirets = _parse_id_list(env, "CHORUS_ALLOWED_SUPPLIER_SIRETS", "CHORUS_ALLOWED_SUPPLIER_IDENTIFIERS")
    internal_ids = _parse_id_list(env, "CHORUS_ALLOWED_SUPPLIER_INTERNAL_IDS", "CHORUS_ALLOWED_SUPPLIER_IDS")
    default = (
        env.get("CHORUS_DEFAULT_SUPPLIER_SIRET")
        or env.get("CHORUS_DEFAULT_SUPPLIER_IDENTIFIER")
        or env.get("CHORUS_DEFAULT_SUPPLIER_ID")
        or None
    )
    return {
        "allowed_supplier_sirets": sirets,
        "allowed_supplier_internal_ids": internal_ids,
        "default_supplier_siret": (_digits(default) or None) if default else None,
        "supplier_dp_enabled": _as_bool(env.get("CHORUS_SUPPLIER_DP_ENABLED"), default=False),
        "strict": _as_bool(env.get("CHORUS_STRICT_BUSINESS_VALIDATION"), default=False),
    }


# ---------------------------------------------------------------------------
# Extraction des champs métier
# ---------------------------------------------------------------------------
def _to_float(value: str | None) -> float | None:
    if not value:
        return None
    cleaned = value.strip().replace(" ", "").replace(",", ".")
    try:
        return round(float(cleaned), 2)
    except (TypeError, ValueError):
        return None


def _join_address(parts: dict[str, str | None]) -> str | None:
    pieces = [
        parts.get("street"),
        parts.get("additional"),
        " ".join(p for p in (parts.get("postal_zone"), parts.get("city")) if p) or None,
        parts.get("country"),
    ]
    joined = ", ".join(p for p in pieces if p)
    return joined or None


def _address_present(parts: dict[str, str | None]) -> bool:
    # « au moins une ligne d'adresse » OU une combinaison ville/CP/pays.
    return bool(parts.get("street") or parts.get("additional") or parts.get("city") or parts.get("postal_zone"))


def _ubl_party(wrapper: ET.Element | None) -> dict[str, Any]:
    if wrapper is None:
        return {"identifier": None, "name": None, "address_parts": {}, "address": None}
    party = _first_descendant(wrapper, "Party") or wrapper

    identification = _first_descendant(party, "PartyIdentification")
    identifier = _text_of(_first_child(identification, "ID")) if identification is not None else None
    legal_entity = _first_descendant(party, "PartyLegalEntity")
    if not identifier and legal_entity is not None:
        identifier = _text_of(_first_child(legal_entity, "CompanyID"))

    party_name = _first_descendant(party, "PartyName")
    name = _text_of(_first_child(party_name, "Name")) if party_name is not None else None
    if not name and legal_entity is not None:
        name = _text_of(_first_child(legal_entity, "RegistrationName"))

    postal = _first_descendant(party, "PostalAddress")
    parts: dict[str, str | None] = {}
    if postal is not None:
        parts = {
            "street": _text_of(_first_child(postal, "StreetName")),
            "additional": _text_of(_first_child(postal, "AdditionalStreetName")),
            "city": _text_of(_first_child(postal, "CityName")),
            "postal_zone": _text_of(_first_child(postal, "PostalZone")),
            "country": _text_of(_first_descendant(postal, "IdentificationCode")),
        }
    return {"identifier": identifier, "name": name, "address_parts": parts, "address": _join_address(parts)}


def _extract_ubl_tax_subtotals(root: ET.Element) -> list[dict[str, Any]]:
    """Liste des cac:TaxSubtotal avec leur taux (TaxCategory/Percent) et montant."""
    subtotals: list[dict[str, Any]] = []
    for tax_total in _iter_descendants(root, "TaxTotal"):
        for subtotal in _iter_descendants(tax_total, "TaxSubtotal"):
            subtotals.append({
                "percent": _text_of(_first_descendant(subtotal, "Percent")),
                "tax_amount": _to_float(_text_of(_first_child(subtotal, "TaxAmount"))),
            })
    return subtotals


def _extract_ubl_business(root: ET.Element) -> dict[str, Any]:
    supplier = _ubl_party(_first_descendant(root, "AccountingSupplierParty"))
    customer = _ubl_party(_first_descendant(root, "AccountingCustomerParty"))
    monetary = _first_descendant(root, "LegalMonetaryTotal")
    tax_total = _first_descendant(root, "TaxTotal")
    tax_subtotals = _extract_ubl_tax_subtotals(root)
    return {
        "invoice_number": _text_of(_first_child(root, "ID")),
        "issue_date": _text_of(_first_child(root, "IssueDate")),
        "currency": _text_of(_first_child(root, "DocumentCurrencyCode")),
        "supplier": supplier,
        "customer": customer,
        "total_ht": _to_float(_text_of(_first_descendant(monetary, "TaxExclusiveAmount"))),
        "total_tva": _to_float(_text_of(_first_child(tax_total, "TaxAmount"))) if tax_total is not None else None,
        "total_ttc": _to_float(_text_of(_first_descendant(monetary, "TaxInclusiveAmount"))),
        "tax_subtotals": tax_subtotals,
        "tax_percentages": [s["percent"] for s in tax_subtotals if s.get("percent")],
    }


def _cii_party(party: ET.Element | None) -> dict[str, Any]:
    if party is None:
        return {"identifier": None, "name": None, "address_parts": {}, "address": None}
    legal = _first_descendant(party, "SpecifiedLegalOrganization")
    identifier = _text_of(_first_child(legal, "ID")) if legal is not None else None
    if not identifier:
        identifier = _text_of(_first_child(party, "ID")) or _text_of(_first_descendant(party, "GlobalID"))
    name = _text_of(_first_child(party, "Name"))
    address = _first_descendant(party, "PostalTradeAddress")
    parts: dict[str, str | None] = {}
    if address is not None:
        parts = {
            "street": _text_of(_first_child(address, "LineOne")),
            "additional": _text_of(_first_child(address, "LineTwo")),
            "city": _text_of(_first_child(address, "CityName")),
            "postal_zone": _text_of(_first_child(address, "PostcodeCode")),
            "country": _text_of(_first_child(address, "CountryID")),
        }
    return {"identifier": identifier, "name": name, "address_parts": parts, "address": _join_address(parts)}


def _extract_cii_business(root: ET.Element) -> dict[str, Any]:
    document = _first_descendant(root, "ExchangedDocument")
    issue = _first_descendant(document, "IssueDateTime") if document is not None else None
    summation = _first_descendant(root, "SpecifiedTradeSettlementHeaderMonetarySummation")
    return {
        "invoice_number": _text_of(_first_child(document, "ID")) if document is not None else None,
        "issue_date": _text_of(_first_descendant(issue, "DateTimeString")),
        "currency": _text_of(_first_descendant(root, "InvoiceCurrencyCode")),
        "supplier": _cii_party(_first_descendant(root, "SellerTradeParty")),
        "customer": _cii_party(_first_descendant(root, "BuyerTradeParty")),
        "total_ht": _to_float(_text_of(_first_descendant(summation, "TaxBasisTotalAmount"))),
        "total_tva": _to_float(_text_of(_first_descendant(summation, "TaxTotalAmount"))),
        "total_ttc": _to_float(_text_of(_first_descendant(summation, "GrandTotalAmount"))),
        "tax_subtotals": [],  # validation Percent UBL uniquement (CII partiel)
        "tax_percentages": [_text_of(p) for p in _iter_descendants(root, "RateApplicablePercent") if _text_of(p)],
    }


# ---------------------------------------------------------------------------
# Validation métier
# ---------------------------------------------------------------------------
def _annuaire_contains(annuaire_lookup: Any, identifier: str) -> tuple[bool, bool | None]:
    """Retourne (connu, actif|None) pour un identifiant dans l'annuaire fourni."""
    digits = _digits(identifier)
    if isinstance(annuaire_lookup, dict):
        for key, value in annuaire_lookup.items():
            if _digits(key) == digits:
                active = value.get("active") if isinstance(value, dict) else None
                return True, active if isinstance(active, bool) else None
        return False, None
    if isinstance(annuaire_lookup, (set, list, tuple)):
        return any(_digits(item) == digits for item in annuaire_lookup), None
    return False, None


def validate_flux_business_rules(
    file_bytes: bytes,
    filename: str,
    detected: dict[str, Any] | None = None,
    format_flux: str | None = None,
    syntaxe_flux: str | None = None,
    annuaire_lookup: dict[str, Any] | None = None,
    supplier_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Valide les données métier d'un flux facture. Voir le module pour le contrat."""
    detected = detected or detect_flux_file(file_bytes, filename)
    detected_type = detected.get("detected_file_type")
    config = supplier_config if supplier_config is not None else load_supplier_config()
    strict = bool(config.get("strict"))

    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    # --- Sélection de la source XML + extraction ---------------------------
    fields: dict[str, Any] | None = None
    if detected_type == UBL_INVOICE:
        root = parse_xml_tree(file_bytes)
        fields = _extract_ubl_business(root) if root is not None else None
    elif detected_type in (CII_INVOICE, FACTURX_CII):
        xml_bytes = file_bytes
        if detected_type == FACTURX_CII:
            _, embedded = extract_embedded_invoice_xml(file_bytes)
            xml_bytes = embedded or b""
        root = parse_xml_tree(xml_bytes) if xml_bytes else None
        fields = _extract_cii_business(root) if root is not None else None
        warnings.append({"code": "CII_PARTIAL", "field": "*", "message": MSG_CII_PARTIAL, "value": None})
    else:
        # Type non couvert par le contrôle métier (pivot/statut/inconnu) :
        # le détecteur/compatibilité gère déjà ces cas en amont.
        return {
            "success": True,
            "business_validation": {
                "valid": True,
                "severity": SEVERITY_OK,
                "errors": [],
                "warnings": [{
                    "code": "BUSINESS_NOT_APPLICABLE", "field": "*",
                    "message": "Contrôle métier non applicable à ce type de fichier.", "value": detected_type,
                }],
                "checks": {},
                "extracted": {},
            },
        }

    if fields is None:
        errors.append({"code": "XML_UNPARSEABLE", "field": "*", "message": "Le XML n'a pas pu être analysé pour le contrôle métier.", "value": None})
        return _result(False, SEVERITY_BLOCKING, errors, warnings, {}, {})

    supplier = fields["supplier"]
    customer = fields["customer"]

    # --- Checks -------------------------------------------------------------
    supplier_id = supplier.get("identifier")
    customer_id = customer.get("identifier")
    supplier_addr_present = _address_present(supplier.get("address_parts", {}))
    customer_addr_present = _address_present(customer.get("address_parts", {}))

    # Le champ XML PartyIdentification.ID est un identifiant MÉTIER (SIRET attendu),
    # à ne jamais comparer aux IDs internes Chorus.
    allowed_sirets = config.get("allowed_supplier_sirets") or []
    allowed_internal_ids = config.get("allowed_supplier_internal_ids") or []
    supplier_digits = _digits(supplier_id) if supplier_id else ""
    supplier_is_siret = len(supplier_digits) == SIRET_LENGTH
    supplier_identifier_type = "SIRET" if supplier_is_siret else ("NON_SIRET" if supplier_id else None)
    supplier_id_known = supplier_is_siret and supplier_digits in allowed_sirets
    dp_enabled = bool(config.get("supplier_dp_enabled"))

    customer_known: bool | None = None
    customer_active: bool | None = None
    if customer_id and annuaire_lookup is not None:
        customer_known, customer_active = _annuaire_contains(annuaire_lookup, customer_id)

    checks = {
        "supplier_identifier_present": bool(supplier_id),
        "supplier_identifier_known": supplier_id_known,
        "supplier_address_present": supplier_addr_present,
        "customer_identifier_present": bool(customer_id),
        "customer_identifier_known": bool(customer_known) if customer_known is not None else False,
        "customer_address_present": customer_addr_present,
        "supplier_dp_application_enabled": dp_enabled,
    }

    def _issue(code: str, field: str, message: str, value: Any, xml_path: str | None, suggested_fix: str | None) -> dict[str, Any]:
        return {
            "code": code,
            "field": field,
            "xml_path": xml_path or field,
            "current_value": value,
            "value": value,  # rétro-compat frontend
            "line": None,  # ElementTree ne conserve pas le numéro de ligne
            "message": message,
            "suggested_fix": suggested_fix or _SUGGESTED_FIX.get(code),
        }

    def err(code: str, field: str, message: str, value: Any = None, xml_path: str | None = None, suggested_fix: str | None = None) -> None:
        errors.append(_issue(code, field, message, value, xml_path, suggested_fix))

    def warn(code: str, field: str, message: str, value: Any = None, xml_path: str | None = None, suggested_fix: str | None = None) -> None:
        warnings.append(_issue(code, field, message, value, xml_path, suggested_fix))

    # Numéro de facture
    if not fields.get("invoice_number"):
        err("INVOICE_NUMBER_MISSING", "Invoice.ID", "Le numéro de facture est absent du flux.")

    # TVA UBL : chaque TaxSubtotal doit porter un Percent numérique (0..100).
    if detected_type == UBL_INVOICE:
        percent_path = "Invoice.TaxTotal.TaxSubtotal.TaxCategory.Percent"
        for subtotal in fields.get("tax_subtotals") or []:
            percent_raw = subtotal.get("percent")
            tax_amount = subtotal.get("tax_amount") or 0.0
            if percent_raw is None or str(percent_raw).strip() == "":
                err("TAX_SUBTOTAL_PERCENT_MISSING", "TaxTotal.TaxSubtotal.Percent",
                    "Le taux de TVA est obligatoire dans chaque TaxSubtotal.",
                    value=None, xml_path=percent_path)
            else:
                percent_value = _to_float(percent_raw)
                if percent_value is None or percent_value < 0 or percent_value > 100:
                    err("TAX_PERCENT_INVALID", "TaxTotal.TaxSubtotal.Percent",
                        "Le taux de TVA doit être un nombre compris entre 0 et 100.",
                        value=percent_raw, xml_path=percent_path)
                elif percent_value == 0 and tax_amount > 0:
                    warn("TAX_PERCENT_ZERO_WITH_AMOUNT", "TaxTotal.TaxSubtotal.Percent",
                         "Le taux de TVA est à 0 alors qu'un montant de TVA est présent.",
                         value=percent_raw, xml_path=percent_path)

    # Fournisseur — identifiant métier (SIRET attendu)
    supplier_field = "AccountingSupplierParty.Party.PartyIdentification.ID"
    if not supplier_id:
        err("SUPPLIER_ID_MISSING", supplier_field, "L'identifiant fournisseur est absent.")
    elif not supplier_is_siret:
        # Format inattendu : on n'invente pas de correspondance avec un ID interne.
        warn("SUPPLIER_ID_NOT_SIRET", supplier_field,
             "L'identifiant fournisseur extrait n'a pas le format SIRET attendu.", supplier_id)
    elif allowed_sirets:
        if not supplier_id_known:
            msg = "Le SIRET fournisseur du XML n'est pas configuré dans CHORUS_ALLOWED_SUPPLIER_SIRETS."
            if strict:
                err("SUPPLIER_SIRET_NOT_ALLOWED", supplier_field, msg, supplier_id)
            else:
                warn("SUPPLIER_SIRET_NOT_ALLOWED", supplier_field, msg, supplier_id)
    elif allowed_internal_ids:
        # Seul un ID interne Chorus est configuré : il ne peut PAS valider un SIRET.
        warn("SUPPLIER_SIRET_NOT_CONFIGURED", supplier_field,
             "Une valeur interne Chorus est configurée, mais le XML contient un SIRET. "
             "Configurez CHORUS_ALLOWED_SUPPLIER_SIRETS pour valider ce champ.", supplier_id)
    else:
        msg = "Impossible de confirmer le SIRET fournisseur (CHORUS_ALLOWED_SUPPLIER_SIRETS non configuré)."
        if strict:
            err("SUPPLIER_SIRET_NOT_CONFIGURED", supplier_field, msg, supplier_id)
        else:
            warn("SUPPLIER_SIRET_NOT_CONFIGURED", supplier_field, msg, supplier_id)

    # Fournisseur — application « Demandes de paiement »
    if not dp_enabled:
        msg = "Impossible de confirmer que la structure fournisseur utilise l'application Demandes de paiement."
        if strict:
            err("SUPPLIER_DP_NOT_ENABLED", "AccountingSupplierParty.Party", msg)
        else:
            warn("SUPPLIER_DP_NOT_ENABLED", "AccountingSupplierParty.Party", msg)

    # Fournisseur — adresse (toujours bloquant : cause directe du rejet observé)
    if not supplier_addr_present:
        err("SUPPLIER_ADDRESS_MISSING", "AccountingSupplierParty.Party.PostalAddress",
            "Vous devez renseigner au moins une ligne d'adresse pour le fournisseur.")

    # Débiteur — identifiant
    if not customer_id:
        err("CUSTOMER_ID_MISSING", "AccountingCustomerParty.Party.PartyIdentification.ID",
            "L'identifiant débiteur/client est absent.")
    elif annuaire_lookup is None:
        warn("ANNUAIRE_UNAVAILABLE", "AccountingCustomerParty.Party.PartyIdentification.ID", MSG_ANNUAIRE_UNAVAILABLE, customer_id)
    elif customer_known is False:
        msg = "Le débiteur/client indiqué n'est pas référencé dans l'annuaire Chorus."
        if strict:
            err("CUSTOMER_ID_NOT_FOUND", "AccountingCustomerParty.Party.PartyIdentification.ID", msg, customer_id)
        else:
            warn("CUSTOMER_ID_NOT_FOUND", "AccountingCustomerParty.Party.PartyIdentification.ID", msg, customer_id)
    elif customer_active is False:
        warn("CUSTOMER_STRUCTURE_INACTIVE", "AccountingCustomerParty.Party", "La structure destinataire semble inactive dans l'annuaire.", customer_id)

    # Débiteur — adresse (toujours bloquant)
    if not customer_addr_present:
        err("CUSTOMER_ADDRESS_MISSING", "AccountingCustomerParty.Party.PostalAddress",
            "Vous devez renseigner au moins une ligne d'adresse pour le débiteur/client.")

    # Devise + totaux
    if not fields.get("currency"):
        warn("CURRENCY_MISSING", "Invoice.DocumentCurrencyCode", "La devise est absente (EUR par défaut attendu).")
    if fields.get("total_ht") is None and fields.get("total_ttc") is None:
        err("TOTALS_MISSING", "LegalMonetaryTotal", "Les montants totaux (HT/TTC) sont absents du flux.")

    severity = SEVERITY_BLOCKING if errors else (SEVERITY_WARNING if warnings else SEVERITY_OK)
    extracted = {
        "invoice_number": fields.get("invoice_number"),
        "supplier_identifier": supplier_id,
        "supplier_business_identifier": supplier_id,
        "supplier_identifier_type": supplier_identifier_type,
        "supplier_sirets_configured": allowed_sirets,
        "supplier_internal_ids_configured": allowed_internal_ids,
        "supplier_name": supplier.get("name"),
        "supplier_address": supplier.get("address"),
        "customer_identifier": customer_id,
        "customer_name": customer.get("name"),
        "customer_address": customer.get("address"),
        "currency": fields.get("currency"),
        "total_ht": fields.get("total_ht"),
        "total_tva": fields.get("total_tva"),
        "total_ttc": fields.get("total_ttc"),
        "tax_percentages": fields.get("tax_percentages") or [],
    }
    return _result(severity != SEVERITY_BLOCKING, severity, errors, warnings, checks, extracted)


def _result(valid: bool, severity: str, errors: list, warnings: list, checks: dict, extracted: dict) -> dict[str, Any]:
    return {
        "success": True,
        "business_validation": {
            "valid": valid,
            "severity": severity,
            "errors": errors,
            "warnings": warnings,
            "checks": checks,
            "extracted": extracted,
        },
    }


def extract_recipient_identifier(file_bytes: bytes, filename: str, detected: dict[str, Any] | None = None) -> str | None:
    """Extrait l'identifiant destinataire (AccountingCustomerParty/PartyIdentification.ID).

    Utilisé pour la validation Annuaire G2B du destinataire. Best-effort, sans
    journaliser le contenu.
    """
    detected = detected or detect_flux_file(file_bytes, filename)
    detected_type = detected.get("detected_file_type")
    if detected_type == UBL_INVOICE:
        root = parse_xml_tree(file_bytes)
        fields = _extract_ubl_business(root) if root is not None else None
    elif detected_type in (CII_INVOICE, FACTURX_CII):
        xml_bytes = file_bytes
        if detected_type == FACTURX_CII:
            _, embedded = extract_embedded_invoice_xml(file_bytes)
            xml_bytes = embedded or b""
        root = parse_xml_tree(xml_bytes) if xml_bytes else None
        fields = _extract_cii_business(root) if root is not None else None
    else:
        return None
    if not fields:
        return None
    return fields["customer"].get("identifier")


# Codes d'erreur « interdits de forçage » (jamais déposables même avec force=true).
NON_FORCEABLE_ERROR_CODES = frozenset({
    "SUPPLIER_ID_MISSING",
    "SUPPLIER_SIRET_NOT_ALLOWED",
    "SUPPLIER_ADDRESS_MISSING",
    "CUSTOMER_ID_MISSING",
    "CUSTOMER_ADDRESS_MISSING",
})
