"""Client pour l'API Chorus Pro `deposer/flux`.

Ce module est volontairement indépendant du flux de dépôt unitaire existant
(`/api/chorus/submit`). Il encapsule uniquement l'appel REST vers Chorus Pro
permettant de déposer un fichier XML ou PDF/A3 sous forme de *flux* de facture.

Référence Chorus Pro: `POST {PISTE_BASE_URL}/factures/v1/deposer/flux`.

Le fichier est lu en binaire côté backend puis encodé en base64 et placé dans
le champ `fichierFlux` du corps JSON. On n'envoie jamais de multipart à Chorus
et on ne journalise jamais le contenu du fichier ni les identifiants.
"""

from __future__ import annotations

import asyncio
import base64
from typing import Any

import requests


# Chemin Chorus Pro (sous la base PISTE `.../cpro`).
CHORUS_DEPOSER_FLUX_PATH = "/factures/v1/deposer/flux"

# Syntaxes de flux autorisées pour le premier MVP.
ALLOWED_SYNTAXES_FLUX: frozenset[str] = frozenset(
    {
        "IN_DP_E1_UBL_INVOICE",
        "IN_DP_E1_CII",
        "IN_DP_E2_CII_FACTURX",
        "IN_DP_E2_UBL_INVOICE_MIN",
        "IN_DP_E2_CII_MIN",
    }
)


class ChorusFluxError(RuntimeError):
    """Erreur lors de l'appel à l'API Chorus Pro `deposer/flux`."""


def is_syntaxe_flux_supported(syntaxe_flux: str) -> bool:
    return syntaxe_flux.strip() in ALLOWED_SYNTAXES_FLUX


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _coerce_code_retour(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _extract_field(body: Any, key: str) -> Any:
    if isinstance(body, dict):
        return body.get(key)
    return None


async def deposer_flux_facture(
    piste_base_url: str,
    access_token: str,
    cpro_account_base64: str,
    file_bytes: bytes,
    filename: str,
    syntaxe_flux: str,
    id_utilisateur_courant: int = 0,
    avec_signature: bool = False,
    *,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Dépose un fichier de flux de facture sur Chorus Pro.

    Encode `file_bytes` en base64, construit le corps JSON attendu par Chorus,
    puis effectue l'appel `POST {piste_base_url}/factures/v1/deposer/flux`.

    Retourne un dictionnaire normalisé contenant `http_status`, `codeRetour`,
    `libelle`, `dateDepot`, `numeroFluxDepot`, `syntaxeFlux` et la réponse brute
    (`raw`).
    """
    if not piste_base_url or not piste_base_url.strip():
        raise ChorusFluxError("URL Chorus Pro (piste_base_url) manquante.")
    if not access_token or not access_token.strip():
        raise ChorusFluxError("Token d'accès OAuth2 manquant.")
    if not cpro_account_base64 or not cpro_account_base64.strip():
        raise ChorusFluxError("En-tête cpro-account manquant.")
    if not file_bytes:
        raise ChorusFluxError("Le fichier de flux est vide.")

    fichier_flux_base64 = base64.b64encode(file_bytes).decode("ascii")

    payload: dict[str, Any] = {
        "avecSignature": bool(avec_signature),
        "fichierFlux": fichier_flux_base64,
        "idUtilisateurCourant": int(id_utilisateur_courant),
        "nomFichier": filename,
        "syntaxeFlux": syntaxe_flux,
    }

    token = access_token.strip()
    authorization = token if token.lower().startswith("bearer ") else f"Bearer {token}"
    headers = {
        "Authorization": authorization,
        "cpro-account": cpro_account_base64,
        "Content-Type": "application/json;charset=utf-8",
        "Accept": "application/json;charset=utf-8",
    }

    url = _join_url(piste_base_url, CHORUS_DEPOSER_FLUX_PATH)

    def _do_request() -> tuple[int, Any]:
        response = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=timeout_seconds,
        )
        try:
            parsed = response.json()
        except ValueError:
            parsed = response.text.strip()
        return response.status_code, parsed

    try:
        http_status, body = await asyncio.to_thread(_do_request)
    except requests.RequestException as error:  # réseau / timeout
        raise ChorusFluxError(
            f"Appel Chorus Pro deposer/flux impossible: {error}"
        ) from error

    return {
        "http_status": http_status,
        "codeRetour": _coerce_code_retour(_extract_field(body, "codeRetour")),
        "libelle": _extract_field(body, "libelle"),
        "dateDepot": _extract_field(body, "dateDepot"),
        "numeroFluxDepot": _extract_field(body, "numeroFluxDepot"),
        "syntaxeFlux": _extract_field(body, "syntaxeFlux") or syntaxe_flux,
        "raw": body,
    }
