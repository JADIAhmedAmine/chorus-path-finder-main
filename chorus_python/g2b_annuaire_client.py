"""Client de l'API G2B « Annuaire » (sandbox: .../g2b/annuaire/v1).

Usage prioritaire : aider à valider le DESTINATAIRE (débiteur) d'une facture —
SIRET connu, structure active, adresse, et règles B2G (code service / engagement
juridique requis). Partagé par le dépôt de flux historique (/v1/deposer/flux) et
le futur dépôt G2B.

Matching SIREN/SIRET en correspondance EXACTE dès maintenant (la prochaine
version de l'Annuaire impose le strict). Sécurité : token PISTE + cpro-account
côté backend, jamais journalisés ; aucun contenu sensible loggé.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import requests


class G2BAnnuaireError(RuntimeError):
    """Erreur lors d'un appel à l'API G2B Annuaire."""


def normalize_siren(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) != 9:
        raise G2BAnnuaireError("SIREN invalide : 9 chiffres attendus.")
    return digits


def normalize_siret(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) != 14:
        raise G2BAnnuaireError("SIRET invalide : 14 chiffres attendus.")
    return digits


def is_active_annuaire_result(result: dict[str, Any]) -> bool:
    """Actif si etatAdministratif == 'A' (ou drapeau d'activité explicite)."""
    if not isinstance(result, dict):
        return False
    etat = result.get("etatAdministratif") or result.get("etat")
    if isinstance(etat, str):
        return etat.strip().upper() == "A"
    for key in ("active", "actif", "structureActive"):
        if isinstance(result.get(key), bool):
            return result[key]
    return False


def _join(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _headers(access_token: str, cpro_account_base64: str, *, json_body: bool = False) -> dict[str, str]:
    token = (access_token or "").strip()
    authorization = token if token.lower().startswith("bearer ") else f"Bearer {token}"
    headers = {
        "Authorization": authorization,
        "cpro-account": cpro_account_base64,
        "Accept": "application/json",
        "Accept-Language": "fr",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _validate(base_url: str, access_token: str, cpro_account_base64: str) -> None:
    if not base_url or not base_url.strip():
        raise G2BAnnuaireError("URL G2B Annuaire manquante.")
    if not access_token or not access_token.strip():
        raise G2BAnnuaireError("Token d'accès OAuth2 manquant.")
    if not cpro_account_base64 or not cpro_account_base64.strip():
        raise G2BAnnuaireError("En-tête cpro-account manquant.")


async def _request(method: str, url: str, headers: dict[str, str], *, json_payload: Any = None, timeout_seconds: float = 30.0) -> tuple[int, Any]:
    def _do() -> tuple[int, Any]:
        response = requests.request(method, url, json=json_payload, headers=headers, timeout=timeout_seconds)
        if response.status_code == 204:
            return 204, None
        try:
            parsed = response.json()
        except ValueError:
            parsed = response.text.strip()
        return response.status_code, parsed

    try:
        return await asyncio.to_thread(_do)
    except requests.RequestException as error:
        raise G2BAnnuaireError(f"Appel G2B Annuaire impossible ({method} {url}): {error}") from error


async def annuaire_healthcheck(base_url: str, access_token: str, cpro_account_base64: str, *, timeout_seconds: float = 15.0) -> dict[str, Any]:
    _validate(base_url, access_token, cpro_account_base64)
    http_status, body = await _request("GET", _join(base_url, "/healthcheck"), _headers(access_token, cpro_account_base64), timeout_seconds=timeout_seconds)
    return {"http_status": http_status, "available": http_status == 200, "raw": body}


# Champs minimaux par défaut (limiter le volume d'appel).
_DEFAULT_SIRET_CHAMPS = [
    "siret", "denomination", "etatAdministratif", "adresse",
    "gestionEngagementJuridique", "gestionCodeService",
    "gestionEngagementJuridiqueOuService", "gestionStatutMiseEnPaiement",
    "moa", "moaUniquement",
]


async def get_siret(
    base_url: str,
    access_token: str,
    cpro_account_base64: str,
    siret: str,
    *,
    champs: list[str] | None = None,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """GET /siret/code-insee:{siret} (correspondance exacte)."""
    _validate(base_url, access_token, cpro_account_base64)
    normalized = normalize_siret(siret)
    http_status, body = await _request(
        "GET", _join(base_url, f"/siret/code-insee:{normalized}"),
        _headers(access_token, cpro_account_base64), timeout_seconds=timeout_seconds,
    )
    return {"http_status": http_status, "siret": normalized, "raw": body}


async def search_siret(
    base_url: str,
    access_token: str,
    cpro_account_base64: str,
    filters: dict[str, Any],
    *,
    champs: list[str] | None = None,
    limite: int = 50,
    ignorer: int = 0,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """POST /siret/recherche (filtres en correspondance exacte côté appelant)."""
    _validate(base_url, access_token, cpro_account_base64)
    limite = max(1, min(int(limite or 50), 250))  # borne API : max 250
    payload: dict[str, Any] = {"filtres": filters, "limite": limite, "ignorer": int(ignorer or 0)}
    if champs:
        payload["champs"] = champs
    http_status, body = await _request(
        "POST", _join(base_url, "/siret/recherche"),
        _headers(access_token, cpro_account_base64, json_body=True), json_payload=payload, timeout_seconds=timeout_seconds,
    )
    return {"http_status": http_status, "raw": body}


def _first_result(body: Any) -> dict[str, Any] | None:
    """Extrait le 1er enregistrement d'une réponse Annuaire (tolérant au schéma)."""
    if isinstance(body, dict):
        for key in ("resultats", "results", "items", "data", "contenu"):
            value = body.get(key)
            if isinstance(value, list) and value:
                return value[0] if isinstance(value[0], dict) else None
        # Réponse « plate » (un seul enregistrement).
        if body.get("siret") or body.get("denomination") or body.get("etatAdministratif"):
            return body
    if isinstance(body, list) and body and isinstance(body[0], dict):
        return body[0]
    return None


def _extract_address(record: dict[str, Any]) -> dict[str, Any]:
    adresse = record.get("adresse") if isinstance(record.get("adresse"), dict) else {}
    return {
        "line1": adresse.get("ligne1") or adresse.get("voie") or adresse.get("adresse") or None,
        "postalCode": adresse.get("codePostal") or adresse.get("cp") or None,
        "city": adresse.get("commune") or adresse.get("ville") or None,
        "country": adresse.get("pays") or adresse.get("codePays") or "FR",
    }


def _extract_rules(record: dict[str, Any], strict_service: bool, strict_engagement: bool) -> dict[str, Any]:
    def flag(*keys: str) -> bool:
        return any(bool(record.get(k)) for k in keys)
    service_required = flag("gestionCodeService", "codeServiceObligatoire")
    engagement_required = flag("gestionEngagementJuridique", "engagementObligatoire")
    either_required = flag("gestionEngagementJuridiqueOuService")
    return {
        "serviceCodeRequired": service_required,
        "engagementRequired": engagement_required,
        "serviceOrEngagementRequired": either_required,
        "statutMiseEnPaiement": flag("gestionStatutMiseEnPaiement"),
        "moa": flag("moa"),
        "moaUniquement": flag("moaUniquement"),
    }


async def validate_recipient(
    base_url: str,
    access_token: str,
    cpro_account_base64: str,
    siret: str,
    *,
    service_code: str | None = None,
    engagement_number: str | None = None,
    strict_service_code: bool = False,
    strict_engagement: bool = False,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Valide un destinataire par SIRET : actif, adresse, règles B2G."""
    normalized = normalize_siret(siret)
    lookup = await get_siret(base_url, access_token, cpro_account_base64, normalized, champs=_DEFAULT_SIRET_CHAMPS, timeout_seconds=timeout_seconds)
    http_status = lookup["http_status"]
    record = _first_result(lookup["raw"])

    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    recommendations: list[str] = []

    if http_status == 204 or record is None:
        return {
            "success": True,
            "recipient": {"siret": normalized, "active": False, "denomination": None, "address": None, "rules": {}},
            "validation": {
                "severity": "BLOCKING",
                "errors": [{"field": "customer.siret", "message": "Le destinataire n'a pas été trouvé dans l'annuaire G2B."}],
                "warnings": [],
                "recommendations": ["Vérifiez le SIRET destinataire."],
            },
            "raw": lookup["raw"],
        }
    if http_status >= 400:
        return {
            "success": False,
            "recipient": {"siret": normalized, "active": None, "denomination": None, "address": None, "rules": {}},
            "validation": {"severity": "WARNING", "errors": [], "warnings": [{"field": "annuaire", "message": f"Annuaire indisponible (HTTP {http_status})."}], "recommendations": []},
            "raw": lookup["raw"],
        }

    active = is_active_annuaire_result(record)
    rules = _extract_rules(record, strict_service_code, strict_engagement)
    if not active:
        errors.append({"field": "customer.siret", "message": "La structure destinataire est inactive dans l'annuaire G2B."})
        recommendations.append("Choisissez un destinataire actif.")
    if rules["serviceCodeRequired"] and not (service_code or "").strip():
        msg = "Code service requis pour ce destinataire."
        (errors if strict_service_code else warnings).append({"field": "chorus.service_code", "message": msg})
        recommendations.append(msg)
    if rules["engagementRequired"] and not (engagement_number or "").strip():
        msg = "Numéro d'engagement juridique requis pour ce destinataire."
        (errors if strict_engagement else warnings).append({"field": "chorus.engagement_number", "message": msg})
        recommendations.append(msg)

    severity = "BLOCKING" if errors else ("WARNING" if warnings else "OK")
    return {
        "success": True,
        "recipient": {
            "siret": normalized,
            "denomination": record.get("denomination") or record.get("raisonSociale"),
            "active": active,
            "address": _extract_address(record),
            "rules": rules,
        },
        "validation": {"severity": severity, "errors": errors, "warnings": warnings, "recommendations": recommendations},
        "raw": lookup["raw"],
    }
