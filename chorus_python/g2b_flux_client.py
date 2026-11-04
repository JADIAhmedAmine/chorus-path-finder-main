"""Client de l'API G2B « Dépôt Flux » (sandbox: .../g2b/flux/v1).

Endpoints :
- GET  /healthcheck
- POST /flux                 -> { uidFlux }
- GET  /flux/{uidFlux}       -> { dateMajStatut, nomFlux, statut } (404 = pas encore traité)

Sécurité : le fichier est lu côté backend, encodé base64 et placé dans
``fichierFlux`` ; on n'envoie jamais de multipart à G2B et on ne journalise ni le
contenu, ni l'``Authorization``, ni le ``cpro-account``.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
from typing import Any

import requests

# Statuts terminaux du suivi de flux.
STATUS_RECEVABLE = "RECEVABLE"
STATUS_IRRECEVABLE = "IRRECEVABLE"
STATUS_ENVELOPPE_VALIDE = "ENTRANT_ENVELOPPE_VALIDE"
TERMINAL_STATUSES = frozenset({STATUS_RECEVABLE, STATUS_IRRECEVABLE})


class G2BFluxError(RuntimeError):
    """Erreur lors d'un appel à l'API G2B Flux."""


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


def compute_checksum(file_bytes: bytes, base64_content: str, checksum_mode: str) -> str:
    """SHA-256 du contenu brut (raw) ou du base64, selon le mode configuré."""
    if checksum_mode == "base64":
        return hashlib.sha256(base64_content.encode("utf-8")).hexdigest()
    return hashlib.sha256(file_bytes).hexdigest()


def _validate(base_url: str, access_token: str, cpro_account_base64: str) -> None:
    if not base_url or not base_url.strip():
        raise G2BFluxError("URL G2B Flux manquante.")
    if not access_token or not access_token.strip():
        raise G2BFluxError("Token d'accès OAuth2 manquant.")
    if not cpro_account_base64 or not cpro_account_base64.strip():
        raise G2BFluxError("En-tête cpro-account manquant.")


async def _request(method: str, url: str, headers: dict[str, str], *, json_payload: Any = None, timeout_seconds: float = 30.0) -> tuple[int, Any]:
    def _do() -> tuple[int, Any]:
        response = requests.request(method, url, json=json_payload, headers=headers, timeout=timeout_seconds)
        try:
            parsed = response.json()
        except ValueError:
            parsed = response.text.strip()
        return response.status_code, parsed

    try:
        return await asyncio.to_thread(_do)
    except requests.RequestException as error:
        raise G2BFluxError(f"Appel G2B Flux impossible ({method} {url}): {error}") from error


async def g2b_flux_healthcheck(base_url: str, access_token: str, cpro_account_base64: str, *, timeout_seconds: float = 15.0) -> dict[str, Any]:
    _validate(base_url, access_token, cpro_account_base64)
    http_status, body = await _request("GET", _join(base_url, "/healthcheck"), _headers(access_token, cpro_account_base64), timeout_seconds=timeout_seconds)
    return {"http_status": http_status, "available": http_status == 200, "raw": body}


async def deposit_g2b_flux(
    base_url: str,
    access_token: str,
    cpro_account_base64: str,
    file_bytes: bytes,
    filename: str,
    code_interface: str,
    *,
    checksum_mode: str = "raw",
    timeout_seconds: float = 60.0,
) -> dict[str, Any]:
    """POST /flux : dépose le fichier (base64) et retourne uidFlux + checksum."""
    _validate(base_url, access_token, cpro_account_base64)
    if not file_bytes:
        raise G2BFluxError("Le fichier de flux est vide.")
    if not code_interface or not code_interface.strip():
        raise G2BFluxError("codeInterface manquant.")

    base64_content = base64.b64encode(file_bytes).decode("ascii")
    checksum = compute_checksum(file_bytes, base64_content, checksum_mode)
    payload = {"codeInterface": code_interface.strip(), "checksum": checksum, "fichierFlux": base64_content}

    http_status, body = await _request(
        "POST", _join(base_url, "/flux"), _headers(access_token, cpro_account_base64, json_body=True),
        json_payload=payload, timeout_seconds=timeout_seconds,
    )
    uid_flux = body.get("uidFlux") if isinstance(body, dict) else None
    return {
        "http_status": http_status,
        "uidFlux": uid_flux,
        "checksum": checksum,
        "checksumMode": checksum_mode,
        "codeInterface": code_interface.strip(),
        "raw": body,
    }


async def get_g2b_flux_status(base_url: str, access_token: str, cpro_account_base64: str, uid_flux: str, *, timeout_seconds: float = 30.0) -> dict[str, Any]:
    """GET /flux/{uidFlux} : statut courant (404 = pas encore traité)."""
    _validate(base_url, access_token, cpro_account_base64)
    if not uid_flux or not uid_flux.strip():
        raise G2BFluxError("uidFlux manquant.")
    http_status, body = await _request("GET", _join(base_url, f"/flux/{uid_flux.strip()}"), _headers(access_token, cpro_account_base64), timeout_seconds=timeout_seconds)
    return {
        "http_status": http_status,
        "statut": body.get("statut") if isinstance(body, dict) else None,
        "dateMajStatut": body.get("dateMajStatut") if isinstance(body, dict) else None,
        "nomFlux": body.get("nomFlux") if isinstance(body, dict) else None,
        "raw": body,
    }


async def poll_g2b_flux_status(
    base_url: str,
    access_token: str,
    cpro_account_base64: str,
    uid_flux: str,
    *,
    max_attempts: int = 8,
    initial_delay_seconds: float = 2.0,
    backoff_factor: float = 1.5,
    timeout_seconds: float = 30.0,
    sleep=asyncio.sleep,
) -> dict[str, Any]:
    """Interroge le statut avec backoff, jusqu'à un statut terminal ou épuisement.

    Le 404 (pas encore traité) et ENTRANT_ENVELOPPE_VALIDE sont transitoires.
    """
    delay = initial_delay_seconds
    last: dict[str, Any] = {}
    for attempt in range(1, max_attempts + 1):
        last = await get_g2b_flux_status(base_url, access_token, cpro_account_base64, uid_flux, timeout_seconds=timeout_seconds)
        statut = last.get("statut")
        if last.get("http_status") == 200 and statut in TERMINAL_STATUSES:
            last["attempts"] = attempt
            last["terminal"] = True
            return last
        if attempt < max_attempts:
            await sleep(delay)
            delay *= backoff_factor
    last["attempts"] = max_attempts
    last["terminal"] = last.get("statut") in TERMINAL_STATUSES
    return last
