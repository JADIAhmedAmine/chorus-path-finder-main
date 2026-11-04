"""Client pour les API Chorus Pro de dépôt de *flux* de facture.

Ce module est volontairement indépendant du flux de dépôt unitaire existant
(`/api/chorus/submit`). Il encapsule les appels REST Chorus Pro permettant de :

- récupérer les formats de flux disponibles (`recuperer/formatflux`) ;
- récupérer les syntaxes XML d'un format (`recuperer/syntaxeflux`) ;
- déposer un fichier XML ou PDF/A3 en flux de facture (`deposer/flux`).

Le fichier est lu en binaire côté backend puis encodé en base64 et placé dans
le champ `fichierFlux` du corps JSON. On n'envoie jamais de multipart à Chorus
et on ne journalise jamais le contenu du fichier ni les identifiants.
"""

from __future__ import annotations

import asyncio
import base64
from typing import Any

import requests


# Chemins Chorus Pro (sous la base PISTE `.../cpro`).
# Les méthodes de référence des flux (formatflux / syntaxeflux) sont exposées
# sous `transverses`, tandis que le dépôt effectif (deposer/flux) est sous
# `factures` (comme la saisie API `soumettre`).
CHORUS_RECUPERER_FORMAT_FLUX_PATH = "/transverses/v1/recuperer/formatflux"
CHORUS_RECUPERER_SYNTAXE_FLUX_PATH = "/transverses/v1/recuperer/syntaxeflux"
CHORUS_DEPOSER_FLUX_PATH = "/factures/v1/deposer/flux"
# Compte rendu de traitement d'un flux déposé (mêmes domaines que deposer/flux).
CHORUS_CONSULTER_CR_PATH = "/factures/v1/consulterCR"
CHORUS_CONSULTER_CR_DETAILLE_PATH = "/factures/v1/consulterCRDetaille"

# Syntaxes de flux du premier MVP (utilisées en repli si l'API formatflux /
# syntaxeflux n'est pas disponible). La source de vérité reste Chorus Pro.
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
    """Erreur lors d'un appel aux API Chorus Pro de flux."""


def is_syntaxe_flux_supported(syntaxe_flux: str) -> bool:
    return syntaxe_flux.strip() in ALLOWED_SYNTAXES_FLUX


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _build_headers(access_token: str, cpro_account_base64: str) -> dict[str, str]:
    token = (access_token or "").strip()
    authorization = token if token.lower().startswith("bearer ") else f"Bearer {token}"
    return {
        "Authorization": authorization,
        "cpro-account": cpro_account_base64,
        "Content-Type": "application/json;charset=utf-8",
        "Accept": "application/json;charset=utf-8",
    }


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


def _field(body: Any, key: str) -> Any:
    return body.get(key) if isinstance(body, dict) else None


def _extract_string_list(body: Any, list_key: str, item_key: str) -> list[str]:
    raw_list = _field(body, list_key)
    if not isinstance(raw_list, list):
        return []
    values: list[str] = []
    for item in raw_list:
        if isinstance(item, dict):
            value = item.get(item_key)
        else:
            value = item
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
    return values


def _validate_common_args(
    piste_base_url: str,
    access_token: str,
    cpro_account_base64: str,
) -> None:
    if not piste_base_url or not piste_base_url.strip():
        raise ChorusFluxError("URL Chorus Pro (piste_base_url) manquante.")
    if not access_token or not access_token.strip():
        raise ChorusFluxError("Token d'accès OAuth2 manquant.")
    if not cpro_account_base64 or not cpro_account_base64.strip():
        raise ChorusFluxError("En-tête cpro-account manquant.")


async def _post_flux_json(
    piste_base_url: str,
    access_token: str,
    cpro_account_base64: str,
    path: str,
    payload: dict[str, Any],
    timeout_seconds: float,
) -> tuple[int, Any]:
    headers = _build_headers(access_token, cpro_account_base64)
    url = _join_url(piste_base_url, path)

    def _do_request() -> tuple[int, Any]:
        response = requests.post(url, json=payload, headers=headers, timeout=timeout_seconds)
        try:
            parsed = response.json()
        except ValueError:
            parsed = response.text.strip()
        return response.status_code, parsed

    try:
        return await asyncio.to_thread(_do_request)
    except requests.RequestException as error:  # réseau / timeout
        raise ChorusFluxError(f"Appel Chorus Pro ({path}) impossible: {error}") from error


async def recuperer_format_flux(
    piste_base_url: str,
    access_token: str,
    cpro_account_base64: str,
    *,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Récupère la liste des formats de flux disponibles (`recuperer/formatflux`)."""
    _validate_common_args(piste_base_url, access_token, cpro_account_base64)

    http_status, body = await _post_flux_json(
        piste_base_url,
        access_token,
        cpro_account_base64,
        CHORUS_RECUPERER_FORMAT_FLUX_PATH,
        {},
        timeout_seconds,
    )

    return {
        "http_status": http_status,
        "codeRetour": _coerce_code_retour(_field(body, "codeRetour")),
        "libelle": _field(body, "libelle"),
        "listeFormatFlux": _extract_string_list(body, "listeFormatFlux", "formatFlux"),
        "raw": body,
    }


async def recuperer_syntaxe_flux(
    piste_base_url: str,
    access_token: str,
    cpro_account_base64: str,
    format_flux: str,
    *,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Récupère les syntaxes XML d'un format de flux (`recuperer/syntaxeflux`)."""
    _validate_common_args(piste_base_url, access_token, cpro_account_base64)
    if not format_flux or not format_flux.strip():
        raise ChorusFluxError("formatFlux manquant.")

    http_status, body = await _post_flux_json(
        piste_base_url,
        access_token,
        cpro_account_base64,
        CHORUS_RECUPERER_SYNTAXE_FLUX_PATH,
        {"formatFlux": format_flux.strip()},
        timeout_seconds,
    )

    return {
        "http_status": http_status,
        "codeRetour": _coerce_code_retour(_field(body, "codeRetour")),
        "libelle": _field(body, "libelle"),
        "listeSyntaxeFlux": _extract_string_list(body, "listeSyntaxeFlux", "syntaxeFlux"),
        "raw": body,
    }


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
    """Dépose un fichier de flux de facture sur Chorus Pro (`deposer/flux`).

    Encode `file_bytes` en base64, construit le corps JSON attendu par Chorus,
    puis effectue l'appel `POST {piste_base_url}/factures/v1/deposer/flux`.

    Retourne un dictionnaire normalisé contenant `http_status`, `codeRetour`,
    `libelle`, `dateDepot`, `numeroFluxDepot`, `syntaxeFlux` et la réponse brute
    (`raw`).
    """
    _validate_common_args(piste_base_url, access_token, cpro_account_base64)
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

    http_status, body = await _post_flux_json(
        piste_base_url,
        access_token,
        cpro_account_base64,
        CHORUS_DEPOSER_FLUX_PATH,
        payload,
        timeout_seconds,
    )

    return {
        "http_status": http_status,
        "codeRetour": _coerce_code_retour(_field(body, "codeRetour")),
        "libelle": _field(body, "libelle"),
        "dateDepot": _field(body, "dateDepot"),
        "numeroFluxDepot": _field(body, "numeroFluxDepot"),
        "syntaxeFlux": _field(body, "syntaxeFlux") or syntaxe_flux,
        "raw": body,
    }


async def consulter_cr_detaille(
    piste_base_url: str,
    access_token: str,
    cpro_account_base64: str,
    numero_flux_depot: str,
    *,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Consulte le compte rendu DÉTAILLÉ d'un flux (`consulterCRDetaille`).

    Renvoie l'état d'intégration du flux et, le cas échéant, les erreurs techniques
    (`listeErreurTechnique`) et par demande de paiement (`listeErreurDP`).
    """
    _validate_common_args(piste_base_url, access_token, cpro_account_base64)
    numero = str(numero_flux_depot or "").strip()
    if not numero:
        raise ChorusFluxError("numeroFluxDepot manquant.")

    http_status, body = await _post_flux_json(
        piste_base_url,
        access_token,
        cpro_account_base64,
        CHORUS_CONSULTER_CR_DETAILLE_PATH,
        {"numeroFluxDepot": numero},
        timeout_seconds,
    )
    return {
        "http_status": http_status,
        "codeRetour": _coerce_code_retour(_field(body, "codeRetour")),
        "libelle": _field(body, "libelle"),
        "raw": body,
    }


async def consulter_cr(
    piste_base_url: str,
    access_token: str,
    cpro_account_base64: str,
    numero_flux_depot: str,
    *,
    timeout_seconds: float = 30.0,
) -> dict[str, Any]:
    """Consulte le compte rendu d'un flux (`consulterCR`) : état + PDF du CR."""
    _validate_common_args(piste_base_url, access_token, cpro_account_base64)
    numero = str(numero_flux_depot or "").strip()
    if not numero:
        raise ChorusFluxError("numeroFluxDepot manquant.")

    http_status, body = await _post_flux_json(
        piste_base_url,
        access_token,
        cpro_account_base64,
        CHORUS_CONSULTER_CR_PATH,
        {"numeroFluxDepot": numero},
        timeout_seconds,
    )
    return {
        "http_status": http_status,
        "codeRetour": _coerce_code_retour(_field(body, "codeRetour")),
        "libelle": _field(body, "libelle"),
        "raw": body,
    }
