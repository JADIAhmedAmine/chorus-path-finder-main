"""Normalisation des factures côté réception/valideur.

Transforme la réponse brute de `/factures/v1/consulter/valideur` en un objet
plat, stable côté frontend. Module pur — pas d'I/O ni de dépendance réseau.

La forme réelle renvoyée par Chorus utilise des wrappers paginés autour des
listes (`lignesDePoste = { lignePoste: [...], pagesLignesPoste, ... }`).
On déballe ces enveloppes tout en restant tolérant aux formes simplifiées
utilisées dans les fixtures de tests.
"""
from __future__ import annotations

from typing import Any, Iterable


# Identifiants possibles côté "partie" (fournisseur ou destinataire). On
# regarde plusieurs clés car Chorus mélange historiquement les noms.
_PARTY_ID_KEYS: tuple[str, ...] = (
    "idStructureCPP",
    "idFournisseur",
    "idDestinataire",
    "idServiceCPP",
    "idServiceFournisseur",
)

_PARTY_NAME_KEYS: tuple[str, ...] = (
    "designation",
    "raisonSociale",
    "designationFournisseur",
    "raisonSocialeFournisseur",
    "designationDestinataire",
    "libelleDestinataire",
    "libelle",
    "nomDestinataire",
)

_PARTY_SIRET_KEYS: tuple[str, ...] = (
    "siret",
    "identifiant",
    "siretFournisseur",
    "siretDestinataire",
    "codeFournisseur",
    "codeDestinataire",
)


def _first_string(source: dict[str, Any] | None, *keys: str) -> str | None:
    if not isinstance(source, dict):
        return None
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return None


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        normalized = value.replace(" ", "").replace(" ", "").replace(",", ".")
        try:
            return float(normalized)
        except ValueError:
            return None
    return None


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "oui", "yes"}:
            return True
        if lowered in {"false", "0", "non", "no"}:
            return False
    return None


def _unwrap_paginated(raw: Any, inner_key: str) -> list[dict[str, Any]]:
    """Retourne la liste interne d'un bloc paginé Chorus.

    Accepte aussi bien `{inner_key: [...], pages..., total...}` que la
    liste plate ou un singleton dict (pour les fixtures de test).
    """
    if isinstance(raw, dict):
        nested = raw.get(inner_key)
        if isinstance(nested, list):
            return [item for item in nested if isinstance(item, dict)]
        # Fixtures historiques : top-level dict avec les mêmes champs que la liste.
        if any(key.startswith("ligne") or key.startswith("pieceJointe") for key in raw):
            return [raw]
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    return []


def _normalize_address(raw: dict[str, Any], prefix: str) -> dict[str, Any] | None:
    """Construit un objet adresse à partir des clés `adresseXxxYyy`."""
    address = {
        "ligne": _first_string(raw, f"adresse{prefix}Detail"),
        "ville": _first_string(raw, f"adresse{prefix}Ville"),
        "codePostal": _first_string(raw, f"adresse{prefix}CodePostal"),
        "codePays": _first_string(raw, f"adresse{prefix}CodePays"),
        "libellePays": _first_string(raw, f"adresse{prefix}LibellePays"),
    }
    if not any(address.values()):
        return None
    return address


def _normalize_party(raw: Any, *, kind: str) -> dict[str, Any] | None:
    """`kind` ∈ {"Fournisseur", "Destinataire"} pilote la lecture d'adresse."""
    if not isinstance(raw, dict):
        return None

    identifier = _first_string(raw, *_PARTY_ID_KEYS)
    siret_or_code = _first_string(raw, *_PARTY_SIRET_KEYS)
    raison_sociale = _first_string(raw, *_PARTY_NAME_KEYS)
    code_service = _first_string(raw, "codeServiceExecutant", "codeService")
    code = _first_string(raw, f"code{kind}", "codeFournisseur", "codeDestinataire")
    type_identifiant = _first_string(raw, f"typeIdentifiant{kind}", "typeIdentifiantStructure")
    service_executant_id = _first_string(raw, "idServiceExecutant", "idServiceCPP")
    service_executant_libelle = _first_string(raw, "libelleServiceExecutant")
    mise_en_paiement = _as_bool(raw.get("miseEnPaiementDestinataire"))
    address = _normalize_address(raw, kind)

    if not any(
        (
            identifier,
            siret_or_code,
            raison_sociale,
            code_service,
            code,
            type_identifiant,
            service_executant_id,
            service_executant_libelle,
            address,
        )
    ):
        return None

    return {
        "id": identifier,
        "siret": siret_or_code,
        "raisonSociale": raison_sociale,
        "codeService": code_service,
        "code": code,
        "typeIdentifiant": type_identifiant,
        "serviceExecutantId": service_executant_id,
        "serviceExecutantLibelle": service_executant_libelle,
        "miseEnPaiement": mise_en_paiement,
        "adresse": address,
    }


def _normalize_dates(raw: dict[str, Any]) -> dict[str, Any]:
    references = raw.get("references") if isinstance(raw.get("references"), dict) else {}
    return {
        # Forme réelle : Chorus pose les dates dans `references`. On garde le
        # fallback top-level pour rester compatible avec les fixtures.
        "dateFacture": _first_string(references, "dateFacture") or _first_string(raw, "dateFacture"),
        "dateDepot": _first_string(references, "dateDepot") or _first_string(raw, "dateDepot"),
        "dateEcheancePaiement": _first_string(
            references, "dateEcheancePaiement"
        ) or _first_string(raw, "dateEcheancePaiement"),
        "dateCreationFacture": _first_string(references, "dateCreationFacture"),
    }


def _normalize_amounts(raw: dict[str, Any]) -> dict[str, Any]:
    totals = raw.get("montantTotal") if isinstance(raw.get("montantTotal"), dict) else {}
    references = raw.get("references") if isinstance(raw.get("references"), dict) else {}
    return {
        "ht": _as_float(totals.get("montantHtTotal")) or 0.0,
        "tva": _as_float(totals.get("montantTVA")) or 0.0,
        "ttc": _as_float(totals.get("montantTtcTotal")) or 0.0,
        "aPayer": _as_float(totals.get("montantAPayer")) or 0.0,
        "remiseGlobaleTtc": _as_float(totals.get("montantRemiseGlobaleTTC")) or 0.0,
        "ttcAvantRemiseGlobale": _as_float(totals.get("montantTtcAvantRemiseGlobalTTC")),
        # Chorus expose `codeDeviseFacture` + `libelleDeviseFacture` ; la
        # forme historique utilisait `deviseFacture`. On supporte les deux.
        "devise": _first_string(references, "codeDeviseFacture", "deviseFacture") or "EUR",
        "libelleDevise": _first_string(references, "libelleDeviseFacture"),
    }


def _normalize_references(raw: dict[str, Any]) -> dict[str, Any]:
    references = raw.get("references") if isinstance(raw.get("references"), dict) else {}
    return {
        "numeroBonCommande": _first_string(references, "numeroBonCommande"),
        "numeroMarche": _first_string(references, "numeroMarche"),
        "numeroDpMandat": _first_string(references, "numeroDpMandat", "numeroDp", "numeroDP"),
        "numeroFactureOrigine": _first_string(references, "numeroFactureOrigine"),
        "motifExonerationTva": _first_string(references, "motifExonerationTva"),
        "modePaiement": _first_string(references, "modePaiement"),
        "typeFacture": _first_string(references, "typeFacture"),
        "typeTva": _first_string(references, "typeTva"),
        "tailleTotalePiecesJointes": _as_float(references.get("tailleTotalePiecesJointes")),
    }


def _normalize_cadre(raw: dict[str, Any]) -> dict[str, Any] | None:
    cadre = raw.get("cadreDeFacturation")
    if not isinstance(cadre, dict):
        return None
    code = _first_string(cadre, "codeCadreFacturation")
    libelle = _first_string(cadre, "libelleCadreFacturation")
    if not code and not libelle:
        return None
    return {"code": code, "libelle": libelle}


def _ensure_attachment_list(raw: Any) -> list[dict[str, Any]]:
    """Renvoie une liste d'attachments, en déballant la forme paginée Chorus."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    if isinstance(raw, dict):
        # Forme réelle : { pieceJointe: [...], pages..., total... }
        nested = raw.get("pieceJointe")
        if isinstance(nested, list):
            return [item for item in nested if isinstance(item, dict)]
        # Forme historique : dict isolé représentant une pièce jointe
        if any(key.startswith("pieceJointe") for key in raw):
            return [raw]
    return []


def _normalize_attachment(raw: dict[str, Any], *, role: str) -> dict[str, Any] | None:
    has_any = any(raw.get(key) for key in raw)
    if not has_any:
        # Bloc principal vide : on le remplace par un stub lisible pour le
        # front, qui sait que la pièce existe mais pas son détail.
        return None
    designation = _first_string(raw, "pieceJointeDesignation", "pieceJointeNomFichier")
    if not designation:
        designation = "Pièce jointe principale" if role == "PRINCIPALE" else "Pièce jointe complémentaire"
    return {
        "role": role,
        "pieceJointeId": _first_string(raw, "pieceJointeId"),
        "designation": designation,
        "typeCode": _first_string(raw, "pieceJointeTypeCode"),
        "typeLibelle": _first_string(raw, "pieceJointeTypeLibelle"),
        "extension": _first_string(raw, "pieceJointeExtension", "pieceJointeExtensionFichier"),
        "mimeType": _first_string(raw, "pieceJointeMimeType"),
        "numeroLigneFacture": _first_string(raw, "pieceJointeNumeroLigneFacture"),
        "idLiaison": _first_string(raw, "pieceJointeIdLiaison"),
    }


def _normalize_principal_attachment(raw: Any) -> dict[str, Any] | None:
    """Gère la forme réelle `{idPieceJointePrincipale, idLiaisonPieceJointePrincipale}`.

    Retourne un attachment minimal si seuls les IDs sont fournis. Sinon
    délègue au format pleine fiche. Accepte aussi un list-wrap (legacy).
    """
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                normalized = _normalize_attachment(item, role="PRINCIPALE")
                if normalized is not None:
                    return normalized
        return None
    if not isinstance(raw, dict):
        return None
    if "idPieceJointePrincipale" in raw or "idLiaisonPieceJointePrincipale" in raw:
        piece_id = _first_string(raw, "idPieceJointePrincipale", "pieceJointeId")
        liaison_id = _first_string(raw, "idLiaisonPieceJointePrincipale", "pieceJointeIdLiaison")
        if not piece_id and not liaison_id:
            return None
        return {
            "role": "PRINCIPALE",
            "pieceJointeId": piece_id,
            "designation": _first_string(raw, "pieceJointePrincipaleDesignation"),
            "typeCode": _first_string(raw, "pieceJointePrincipaleTypeCode"),
            "typeLibelle": None,
            "extension": None,
            "mimeType": None,
            "numeroLigneFacture": None,
            "idLiaison": liaison_id,
        }
    # Cas legacy : la principale a la même forme qu'une PJ standard.
    return _normalize_attachment(raw, role="PRINCIPALE")


def _merge_principal_with_list(
    principal: dict[str, Any] | None,
    additional: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fusionne la pièce principale avec la liste détaillée.

    Si la principale n'expose que des IDs, on cherche son équivalent dans la
    liste complémentaire (via `pieceJointeIdLiaison` / `pieceJointeId`) et on
    retag cette ligne en PRINCIPALE plutôt que de dupliquer.
    """
    if principal is None:
        return additional

    principal_id = principal.get("pieceJointeId")
    principal_liaison = principal.get("idLiaison")
    merged: list[dict[str, Any]] = []
    matched = False
    for item in additional:
        if not matched and (
            (principal_id and item.get("pieceJointeId") == principal_id)
            or (principal_liaison and item.get("idLiaison") == principal_liaison)
            or (principal_liaison and item.get("pieceJointeId") == principal_liaison)
        ):
            merged.append({**item, "role": "PRINCIPALE"})
            matched = True
        else:
            merged.append(item)

    if not matched:
        merged.insert(0, principal)
    return merged


def _normalize_lines(raw: Any) -> list[dict[str, Any]]:
    items = _unwrap_paginated(raw, "lignePoste")
    normalized: list[dict[str, Any]] = []
    for index, line in enumerate(items):
        normalized.append(
            {
                "numero": _first_string(line, "lignePosteNumero") or str(index + 1),
                "reference": _first_string(line, "lignePosteReference"),
                "denomination": _first_string(line, "lignePosteDenomination"),
                "quantite": _as_float(line.get("lignePosteQuantite")),
                "unite": _first_string(line, "lignePosteUniteLibelle", "lignePosteUnite"),
                "puHt": _as_float(line.get("lignePosteMontantUnitaireHT")),
                "remiseHt": _as_float(line.get("lignePosteMontantRemiseHT")),
                "tauxTva": _first_string(line, "lignePosteTauxTva", "lignePosteTauxTvaManuel"),
                "montantTva": _as_float(line.get("lignePosteMontantTva")),
                "montantHtApresRemise": _as_float(line.get("lignePosteMontantHtApresRemise")),
                "montantTtcApresRemise": _as_float(line.get("lignePosteMontantTtcApresRemise")),
            }
        )
    return normalized


def _normalize_vat_recap(raw: Any) -> list[dict[str, Any]]:
    items = _unwrap_paginated(raw, "ligneTva")
    normalized: list[dict[str, Any]] = []
    for row in items:
        normalized.append(
            {
                "taux": _first_string(
                    row,
                    "ligneTvaTauxRefCode",
                    "ligneTvaTaux",
                    "ligneTvaTauxManuel",
                ),
                "tauxValeur": _as_float(row.get("ligneTvaTauxRefValeur")),
                "baseHt": _as_float(row.get("ligneTvaMontantBaseHtParTaux")),
                "montantTva": _as_float(row.get("ligneTvaMontantTvaParTaux")),
            }
        )
    return normalized


def normalize_invoice_for_reception(facture: Any) -> dict[str, Any] | None:
    """Convertit la `facture` retournée par Chorus en objet à plat.

    Retourne `None` si l'entrée n'est pas un dict — c'est la responsabilité
    de l'appelant de gérer cette absence.
    """
    if not isinstance(facture, dict):
        return None

    identifier_value = facture.get("identifiantFactureCPP")
    if isinstance(identifier_value, (int, float)) and not isinstance(identifier_value, bool):
        identifier: int | None = int(identifier_value)
    elif isinstance(identifier_value, str) and identifier_value.strip().isdigit():
        identifier = int(identifier_value.strip())
    else:
        identifier = None

    principal_raw = facture.get("pieceJointePrincipale")
    principal = _normalize_principal_attachment(principal_raw)
    additional_raw = _ensure_attachment_list(facture.get("listeDesPiecesJointes"))
    additional = [
        item
        for item in (
            _normalize_attachment(piece, role="COMPLEMENTAIRE") for piece in additional_raw
        )
        if item is not None
    ]
    # Si pieceJointePrincipale est un dict legacy (pleine fiche) et qu'il n'a
    # pas été traité comme stub, on le récupère via _ensure_attachment_list.
    if principal is None and isinstance(principal_raw, dict):
        legacy_principal_list = _ensure_attachment_list(principal_raw)
        if legacy_principal_list:
            principal = _normalize_attachment(legacy_principal_list[0], role="PRINCIPALE")
    pieces_jointes = _merge_principal_with_list(principal, additional)

    return {
        "identifiantFactureCPP": identifier,
        "numeroFacture": _first_string(facture, "numeroFacture", "numeroFactureSaisi"),
        "statutFacture": _first_string(facture, "statutFacture"),
        "modeDepot": _first_string(facture, "modeDepot"),
        "rejetTraite": _as_bool(facture.get("rejetTraite")),
        "commentaire": _first_string(facture, "commentaire"),
        "cadreDeFacturation": _normalize_cadre(facture),
        "fournisseur": _normalize_party(facture.get("fournisseur"), kind="Fournisseur"),
        "destinataire": _normalize_party(facture.get("destinataire"), kind="Destinataire"),
        "dates": _normalize_dates(facture),
        "montants": _normalize_amounts(facture),
        "references": _normalize_references(facture),
        "piecesJointes": pieces_jointes,
        "lignesDePoste": _normalize_lines(facture.get("lignesDePoste")),
        "recapitulatifTva": _normalize_vat_recap(facture.get("recapitulatifDeTva")),
    }


def coerce_identifier_list(values: Iterable[Any]) -> list[int]:
    """Convertit un itérable en liste d'identifiants positifs uniques (ordre conservé)."""
    seen: set[int] = set()
    result: list[int] = []
    for value in values:
        candidate: int | None = None
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            candidate = value
        elif isinstance(value, float) and value.is_integer():
            candidate = int(value)
        elif isinstance(value, str):
            stripped = value.strip()
            if stripped.isdigit():
                candidate = int(stripped)
        if candidate is not None and candidate > 0 and candidate not in seen:
            seen.add(candidate)
            result.append(candidate)
    return result
