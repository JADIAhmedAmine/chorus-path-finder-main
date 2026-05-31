"""Configuration du module G2B (API officielle Chorus Pro « G2B »).

Le module G2B est additif : il ne modifie ni `/api/chorus/submit` ni le module
de dépôt de flux historique. Les URLs de base, le mode de checksum et la
configuration fournisseur sont pilotés par variables d'environnement (jamais de
secret côté frontend).
"""

from __future__ import annotations

from typing import Any

from .chorus_flux_business_validator import _as_bool, _digits, _parse_id_list
from .config import load_env_values

# URLs sandbox officielles (surchargées par env pour la production).
DEFAULT_ANNUAIRE_BASE_URL = "https://sandbox-api.piste.gouv.fr/g2b/annuaire/v1"
DEFAULT_FLUX_BASE_URL = "https://sandbox-api.piste.gouv.fr/g2b/flux/v1"
DEFAULT_RACCORDEMENT_BASE_URL = "https://sandbox-api.piste.gouv.fr/g2b/raccordements/v1"

# codeInterface G2B (À NE PAS confondre avec les anciens codes EDI FSO1100A…).
CODE_INTERFACE_UBL = "FSO3110A"          # flux facture UBL 2.1
CODE_INTERFACE_FACTURX = "FSO3117A"      # flux facture Factur-X D22B
CODE_INTERFACE_CDV_FACTURE = "FSO3300A"  # cycle de vie facture
CODE_INTERFACE_E_REPORTING = "FSO6000A"  # e-reporting

KNOWN_CODE_INTERFACES = frozenset(
    {CODE_INTERFACE_UBL, CODE_INTERFACE_FACTURX, CODE_INTERFACE_CDV_FACTURE, CODE_INTERFACE_E_REPORTING}
)


def load_g2b_settings(env: dict[str, str] | None = None) -> dict[str, Any]:
    """URLs de base G2B + mode de checksum (raw|base64)."""
    env = env if env is not None else load_env_values()
    checksum_mode = (env.get("G2B_FLUX_CHECKSUM_MODE") or "raw").strip().lower()
    if checksum_mode not in {"raw", "base64"}:
        checksum_mode = "raw"
    return {
        "annuaire_base_url": (env.get("G2B_ANNUAIRE_BASE_URL") or DEFAULT_ANNUAIRE_BASE_URL).rstrip("/"),
        "flux_base_url": (env.get("G2B_FLUX_BASE_URL") or DEFAULT_FLUX_BASE_URL).rstrip("/"),
        "raccordement_base_url": (env.get("G2B_RACCORDEMENT_BASE_URL") or DEFAULT_RACCORDEMENT_BASE_URL).rstrip("/"),
        "checksum_mode": checksum_mode,
        # Intégration Annuaire dans le pré-contrôle métier du dépôt de flux historique.
        # Désactivée par défaut : la validation destinataire à la demande reste
        # disponible via /api/g2b/annuaire/validate-recipient.
        "annuaire_enabled": _as_bool(env.get("G2B_ANNUAIRE_ENABLED"), default=False),
    }


def load_g2b_supplier_config(env: dict[str, str] | None = None) -> dict[str, Any]:
    """Config fournisseur G2B (SIRET autorisés, IDs internes, DP, modes stricts).

    Le SIRET du XML (PartyIdentification.ID) n'est JAMAIS comparé à un ID interne.
    Repli rétro-compatible sur les variables CHORUS_* si les G2B_* sont absentes.
    """
    env = env if env is not None else load_env_values()
    sirets = _parse_id_list(env, "G2B_ALLOWED_SUPPLIER_SIRETS", "CHORUS_ALLOWED_SUPPLIER_SIRETS", "CHORUS_ALLOWED_SUPPLIER_IDENTIFIERS")
    internal_ids = _parse_id_list(env, "G2B_SUPPLIER_INTERNAL_IDS", "CHORUS_ALLOWED_SUPPLIER_INTERNAL_IDS", "CHORUS_ALLOWED_SUPPLIER_IDS")
    default = env.get("G2B_DEFAULT_SUPPLIER_SIRET") or env.get("CHORUS_DEFAULT_SUPPLIER_SIRET") or None
    strict_business = _as_bool(env.get("G2B_STRICT_BUSINESS_VALIDATION"), default=_as_bool(env.get("CHORUS_STRICT_BUSINESS_VALIDATION"), default=False))
    return {
        "allowed_supplier_sirets": sirets,
        "allowed_supplier_internal_ids": internal_ids,
        "default_supplier_siret": (_digits(default) or None) if default else None,
        "supplier_dp_enabled": _as_bool(env.get("G2B_SUPPLIER_DP_ENABLED"), default=_as_bool(env.get("CHORUS_SUPPLIER_DP_ENABLED"), default=False)),
        "strict": strict_business,
        "strict_annuaire": _as_bool(env.get("G2B_STRICT_ANNUAIRE_VALIDATION"), default=False),
        "strict_service_code": _as_bool(env.get("G2B_STRICT_SERVICE_CODE_VALIDATION"), default=False),
        "strict_engagement": _as_bool(env.get("G2B_STRICT_ENGAGEMENT_VALIDATION"), default=False),
    }
