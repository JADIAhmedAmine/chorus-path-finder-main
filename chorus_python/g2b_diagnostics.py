"""Diagnostics G2B : statut de configuration PISTE et erreurs d'auth structurées.

Ne renvoie JAMAIS de valeur secrète (token, client_secret, cpro-account,
mot de passe) — uniquement des booléens « configuré ? » et des champs sûrs.
"""

from __future__ import annotations

import re
from typing import Any

from .chorus_flux_business_validator import _digits
from .config import load_chorus_settings, load_env_values
from .g2b_config import load_g2b_settings


def piste_config_status() -> dict[str, bool]:
    """Booléens « configuré ? » pour l'OAuth PISTE (jamais les valeurs)."""
    try:
        settings = load_chorus_settings()
    except Exception:  # noqa: BLE001
        settings = None
    return {
        "token_url_configured": bool(getattr(settings, "token_url", "") or ""),
        "client_id_configured": bool(getattr(settings, "client_id", "") or ""),
        "client_secret_configured": bool(getattr(settings, "client_secret", "") or ""),
        "api_key_configured": bool(getattr(settings, "api_key", "") or ""),
        "cpro_account_configured": bool(getattr(settings, "cpro_account", "") or ""),
    }


def build_piste_auth_error(api: str) -> dict[str, Any]:
    """Erreur structurée PISTE_AUTH_FAILED (sans secret)."""
    status = piste_config_status()
    return {
        "success": False,
        "error_code": "PISTE_AUTH_FAILED",
        "friendly_message": "Authentification PISTE échouée.",
        "suggested_fix": (
            "Vérifiez PISTE_CLIENT_ID, PISTE_CLIENT_SECRET, PISTE_TOKEN_URL et les habilitations "
            "de l'application PISTE pour les APIs G2B."
        ),
        "debug": {
            "token_url_configured": status["token_url_configured"],
            "client_id_configured": status["client_id_configured"],
            "client_secret_configured": status["client_secret_configured"],
            "api": api,
        },
    }


def is_auth_http_status(http_status: int | None) -> bool:
    return http_status in (401, 403)


def _list_for_key(env: dict[str, str], key: str) -> list[str]:
    raw = env.get(key)
    if not raw:
        return []
    return [d for d in (_digits(part) for part in re.split(r"[,;\s]+", raw)) if d]


def config_diagnostic() -> dict[str, Any]:
    """Vue de configuration sûre (jamais de secret) pour le diagnostic."""
    env = load_env_values()
    status = piste_config_status()
    g2b = load_g2b_settings(env)
    return {
        "success": True,
        "piste": {
            "token_url_configured": status["token_url_configured"],
            "client_id_configured": status["client_id_configured"],
            "client_secret_configured": status["client_secret_configured"],
            "api_key_configured": status["api_key_configured"],
        },
        "g2b": {
            "flux_base_url": g2b["flux_base_url"],
            "annuaire_base_url": g2b["annuaire_base_url"],
            "annuaire_enabled": g2b["annuaire_enabled"],
            "checksum_mode": g2b["checksum_mode"],
        },
        "supplier": {
            "chorus_allowed_supplier_sirets": _list_for_key(env, "CHORUS_ALLOWED_SUPPLIER_SIRETS"),
            "g2b_allowed_supplier_sirets": _list_for_key(env, "G2B_ALLOWED_SUPPLIER_SIRETS"),
            "chorus_supplier_internal_ids": _list_for_key(env, "CHORUS_SUPPLIER_INTERNAL_IDS"),
            "g2b_supplier_internal_ids": _list_for_key(env, "G2B_SUPPLIER_INTERNAL_IDS"),
        },
        "cpro_account_configured": status["cpro_account_configured"],
    }
