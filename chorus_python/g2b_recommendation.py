"""Recommandation « grand public » du codeInterface G2B selon le fichier détecté.

S'appuie sur le détecteur existant (``chorus_flux_detector``) et reste indicatif :
le dépôt réel passe par l'API G2B Flux.
"""

from __future__ import annotations

from typing import Any

from .chorus_flux_detector import (
    CHORUS_LIFECYCLE_STATUS_OUTPUT,
    CHORUS_PIVOT_OUTPUT,
    CII_INVOICE,
    FACTURX_CII,
    PDF_GENERIC,
    UBL_INVOICE,
)
from .g2b_config import CODE_INTERFACE_FACTURX, CODE_INTERFACE_UBL

# codeInterface conseillé par type détecté.
_CODE_INTERFACE_BY_TYPE: dict[str, str] = {
    UBL_INVOICE: CODE_INTERFACE_UBL,
    CII_INVOICE: CODE_INTERFACE_UBL,   # CII brut: à convertir/normaliser, pas de Factur-X
    FACTURX_CII: CODE_INTERFACE_FACTURX,
}


def recommend_g2b_code_interface(detected_file_type: str) -> str | None:
    return _CODE_INTERFACE_BY_TYPE.get(detected_file_type)


def build_g2b_recommendation(
    detected_file_type: str,
    *,
    business_severity: str | None = None,
    annuaire_active: bool | None = None,
) -> dict[str, Any]:
    """Retourne {status, title, recommendedCodeInterface, shortExplanation, why, actionLabel}."""
    code = recommend_g2b_code_interface(detected_file_type)

    def make(status: str, title: str, short: str, why: str, action: str) -> dict[str, Any]:
        return {
            "status": status,
            "title": title,
            "recommendedCodeInterface": code,
            "shortExplanation": short,
            "why": why,
            "actionLabel": action,
        }

    if detected_file_type == CHORUS_PIVOT_OUTPUT:
        return make("blocked", "Dépôt non autorisé", "Ce fichier est un flux pivot sortant Chorus.",
                    "Ce n'est pas un flux d'entrée à déposer.", "Choisissez un autre fichier.")
    if detected_file_type == CHORUS_LIFECYCLE_STATUS_OUTPUT:
        return make("blocked", "Dépôt non autorisé", "Ce fichier est un flux retour / cycle de vie.",
                    "Ce n'est pas une facture à déposer.", "Choisissez un autre fichier.")
    if detected_file_type == PDF_GENERIC:
        return make("blocked", "Conversion requise", "Ce PDF ne contient pas de XML structuré.",
                    "L'API G2B Flux attend un UBL ou un Factur-X.", "Convertissez le PDF en UBL ou Factur-X.")

    if detected_file_type == FACTURX_CII:
        base = make("recommended", "Dépôt Factur-X recommandé", "Ce PDF contient un XML Factur-X embarqué.",
                    f"Pour l'API G2B Dépôt Flux, utilisez {CODE_INTERFACE_FACTURX}.", "Vous pouvez déposer ce flux après validation métier.")
    elif detected_file_type == UBL_INVOICE:
        base = make("recommended", "Dépôt UBL recommandé", "Ce fichier est une facture XML UBL.",
                    f"Pour l'API G2B Dépôt Flux, utilisez {CODE_INTERFACE_UBL}.", "Vous pouvez déposer ce flux après validation métier.")
    elif detected_file_type == CII_INVOICE:
        base = make("warning", "CII brut détecté", "Ce fichier est une facture XML CII (non Factur-X).",
                    "Vérifiez l'interface : un CII brut peut nécessiter une conversion.", "Vérifiez la compatibilité avant dépôt.")
    else:
        return make("blocked", "Type non reconnu", "Le type de fichier n'est pas reconnu.",
                    "Impossible de recommander une interface de dépôt.", "Vérifiez le fichier.")

    # Surcouche métier / annuaire (le format est correct mais les données bloquent).
    if business_severity == "BLOCKING":
        base.update({
            "status": "blocked",
            "title": "Format correct, données métier à corriger",
            "shortExplanation": "Le fichier est au bon format, mais des données métier bloquent le dépôt.",
            "why": "Identifiants, adresses ou taux de TVA incomplets/non reconnus.",
            "actionLabel": "Corrigez les champs indiqués avant dépôt.",
        })
    elif annuaire_active is False:
        base.update({
            "status": "blocked",
            "title": "Destinataire inactif",
            "actionLabel": "Choisissez un destinataire actif.",
        })
    elif business_severity == "WARNING":
        base["status"] = "warning"
    return base
