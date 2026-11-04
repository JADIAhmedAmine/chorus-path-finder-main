from __future__ import annotations

import base64
import binascii
import gzip
import io
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ANNUAIRE_DIR = REPO_ROOT / "public" / "annuaire"
DEFAULT_ANNUAIRE_JSON_PATH = DEFAULT_ANNUAIRE_DIR / "annuaire.normalized.json"
DEFAULT_ANNUAIRE_XML_FILENAME = "annuaire.destinataire.xml"
ANNUAIRE_TENANT_ID = "chorus-annuaire"
ANNUAIRE_TIMESTAMP = "1970-01-01T00:00:00.000Z"


@dataclass(slots=True)
class DecodedAnnuaireFile:
    content: bytes
    source_file: str


@dataclass(slots=True)
class AnnuaireCatalog:
    public_customers: list[dict[str, Any]]
    public_services: list[dict[str, Any]]
    structure_count: int
    service_count: int


@dataclass(slots=True)
class AnnuaireBuildResult:
    payload: dict[str, Any]
    json_path: Path
    xml_path: Path


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if tag.startswith("{") else tag


def _direct_children(parent: ET.Element, tag_name: str) -> list[ET.Element]:
    return [child for child in list(parent) if _local_name(child.tag) == tag_name]


def _direct_child(parent: ET.Element, tag_name: str) -> ET.Element | None:
    matches = _direct_children(parent, tag_name)
    return matches[0] if matches else None


def _direct_child_text(parent: ET.Element, tag_name: str) -> str:
    child = _direct_child(parent, tag_name)
    return "".join(child.itertext()).strip() if child is not None else ""


def _as_boolean(value: str, fallback: bool = False) -> bool:
    normalized = value.strip().lower()
    if not normalized:
        return fallback
    return normalized in {"true", "1", "oui", "yes"}


def _get_boolean_text(parent: ET.Element, tag_name: str, fallback: bool = False) -> bool:
    return _as_boolean(_direct_child_text(parent, tag_name), fallback)


def _normalize_identifier(value: str) -> str:
    return value.strip()


def _derive_structure_type(structure_node: ET.Element) -> str:
    if _get_boolean_text(structure_node, "EstMOAUniquement"):
        return "MOA"

    if _get_boolean_text(structure_node, "EstMOA"):
        return "MOA"

    if _get_boolean_text(structure_node, "GestionService"):
        return "SERVICE"

    return "PUBLIC"


def _derive_siret(type_identifiant: str, identifiant: str) -> str:
    digits = re.sub(r"\D", "", identifiant)
    if len(digits) == 14:
        return digits

    if type_identifiant == "SIRET" and digits:
        return digits

    return ""


def _xml_bytes(xml_content: bytes | str) -> bytes:
    return xml_content if isinstance(xml_content, bytes) else xml_content.encode("utf-8")


def parse_chorus_annuaire_xml(xml_content: bytes | str) -> AnnuaireCatalog:
    try:
        root = ET.fromstring(_xml_bytes(xml_content))
    except ET.ParseError as error:
        raise ValueError(f"Le fichier annuaire Chorus XML est invalide: {error}") from error

    structure_nodes = [
        node
        for node in root.iter()
        if _local_name(node.tag) == "CPPStructurePartenaireUnitaire"
    ]
    customers_by_id: dict[str, dict[str, Any]] = {}
    services_by_id: dict[str, dict[str, Any]] = {}
    service_count = 0

    for structure_node in structure_nodes:
        identifiant = _normalize_identifier(_direct_child_text(structure_node, "Identifiant"))
        if not identifiant:
            continue

        type_identifiant = _normalize_identifier(_direct_child_text(structure_node, "TypeIdentifiant"))
        customer_id = f"annuaire-{identifiant}"
        customers_by_id[customer_id] = {
            "id": customer_id,
            "tenantId": ANNUAIRE_TENANT_ID,
            "codeDestinataire": identifiant,
            "legalName": _direct_child_text(structure_node, "RaisonSociale") or identifiant,
            "siret": _derive_siret(type_identifiant, identifiant),
            "structureType": _derive_structure_type(structure_node),
            "active": _get_boolean_text(structure_node, "StructureActive", True),
            "createdAt": ANNUAIRE_TIMESTAMP,
            "updatedAt": ANNUAIRE_TIMESTAMP,
        }

        services_container = _direct_child(structure_node, "Services")
        if services_container is None:
            continue

        for service_node in _direct_children(services_container, "Service"):
            code_service_executant = _normalize_identifier(_direct_child_text(service_node, "Code"))
            if not code_service_executant:
                continue

            service_count += 1
            service_id = f"{customer_id}::{code_service_executant}"
            services_by_id[service_id] = {
                "id": service_id,
                "tenantId": ANNUAIRE_TENANT_ID,
                "publicCustomerId": customer_id,
                "codeServiceExecutant": code_service_executant,
                "label": _direct_child_text(service_node, "Nom") or code_service_executant,
                "engagementRequired": _get_boolean_text(structure_node, "GestionEngagement")
                or _get_boolean_text(structure_node, "GestionServiceEngagement"),
                "purchaseOrderRequired": False,
                "active": _get_boolean_text(service_node, "ServiceActif", True),
                "createdAt": ANNUAIRE_TIMESTAMP,
                "updatedAt": ANNUAIRE_TIMESTAMP,
            }

    return AnnuaireCatalog(
        public_customers=list(customers_by_id.values()),
        public_services=list(services_by_id.values()),
        structure_count=len(structure_nodes),
        service_count=service_count,
    )


def _safe_basename(value: str) -> str:
    basename = Path(value).name.strip()
    if not basename:
        return DEFAULT_ANNUAIRE_XML_FILENAME

    sanitized = re.sub(r"[^A-Za-z0-9._-]", "_", basename)
    return sanitized or DEFAULT_ANNUAIRE_XML_FILENAME


def _decode_base64(value: str) -> bytes:
    raw_value = value.strip()
    if raw_value.startswith("data:") and "," in raw_value:
        raw_value = raw_value.split(",", 1)[1]

    compact_value = "".join(raw_value.split())
    try:
        decoded = base64.b64decode(compact_value, validate=True)
    except binascii.Error as error:
        raise ValueError("Le champ fichierResultat n'est pas un base64 valide.") from error

    if not decoded.strip():
        raise ValueError("Le champ fichierResultat base64 est vide après décodage.")

    return decoded


def _looks_like_xml(content: bytes) -> bool:
    stripped = content.lstrip()
    return stripped.startswith(b"<?xml") or stripped.startswith(b"<CPPStructuresPartenaires")


def _read_zip_annuaire(content: bytes) -> DecodedAnnuaireFile:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        candidates = [name for name in archive.namelist() if not name.endswith("/")]
        if not candidates:
            raise ValueError("L'archive annuaire Chorus est vide.")

        preferred_names = [
            name
            for name in candidates
            if name.lower().endswith((".xml", ".far")) or Path(name).name.startswith("FAR")
        ]

        for name in [*preferred_names, *candidates]:
            file_content = archive.read(name)
            if _looks_like_xml(file_content) or b"CPPStructurePartenaireUnitaire" in file_content[:5000]:
                return DecodedAnnuaireFile(
                    content=file_content,
                    source_file=_safe_basename(name),
                )

    raise ValueError("Aucun fichier XML d'annuaire Chorus trouvé dans l'archive.")


def decode_chorus_annuaire_file(fichier_resultat_base64: str) -> DecodedAnnuaireFile:
    content = _decode_base64(fichier_resultat_base64)

    if content.startswith(b"PK\x03\x04"):
        return _read_zip_annuaire(content)

    if content.startswith(b"\x1f\x8b"):
        content = gzip.decompress(content)

    return DecodedAnnuaireFile(
        content=content,
        source_file=DEFAULT_ANNUAIRE_XML_FILENAME,
    )


def build_chorus_annuaire_payload(
    xml_content: bytes | str,
    *,
    source_file: str,
    generated_at: str | None = None,
) -> dict[str, Any]:
    catalog = parse_chorus_annuaire_xml(xml_content)

    return {
        "metadata": {
            "generatedAt": generated_at or utc_now_iso(),
            "sourceFile": source_file,
            "structureCount": catalog.structure_count,
            "serviceCount": catalog.service_count,
            "format": "json",
        },
        "publicCustomers": catalog.public_customers,
        "publicServices": catalog.public_services,
    }


def write_chorus_annuaire_files(
    xml_content: bytes | str,
    *,
    source_file: str,
    json_output_path: Path = DEFAULT_ANNUAIRE_JSON_PATH,
    xml_output_path: Path | None = None,
) -> AnnuaireBuildResult:
    source_filename = _safe_basename(source_file)
    resolved_xml_output_path = xml_output_path or DEFAULT_ANNUAIRE_DIR / source_filename
    payload = build_chorus_annuaire_payload(xml_content, source_file=source_filename)

    json_output_path.parent.mkdir(parents=True, exist_ok=True)
    resolved_xml_output_path.parent.mkdir(parents=True, exist_ok=True)
    json_output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    resolved_xml_output_path.write_bytes(_xml_bytes(xml_content))

    return AnnuaireBuildResult(
        payload=payload,
        json_path=json_output_path,
        xml_path=resolved_xml_output_path,
    )


def build_annuaire_files_from_api_response(
    response_body: Any,
    *,
    json_output_path: Path = DEFAULT_ANNUAIRE_JSON_PATH,
    xml_output_path: Path | None = None,
) -> AnnuaireBuildResult:
    if not isinstance(response_body, dict):
        raise ValueError("La réponse de téléchargement annuaire doit être un objet JSON.")

    code_retour = response_body.get("codeRetour")
    if code_retour not in (0, "0", None):
        libelle = response_body.get("libelle") or "libellé indisponible"
        raise ValueError(f"Téléchargement annuaire refusé par Chorus: codeRetour={code_retour}, libelle={libelle}.")

    fichier_resultat = response_body.get("fichierResultat")
    if not isinstance(fichier_resultat, str) or not fichier_resultat.strip():
        raise ValueError("La réponse Chorus ne contient pas fichierResultat.")

    decoded_file = decode_chorus_annuaire_file(fichier_resultat)
    return write_chorus_annuaire_files(
        decoded_file.content,
        source_file=decoded_file.source_file,
        json_output_path=json_output_path,
        xml_output_path=xml_output_path,
    )


def relative_to_repo(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path.resolve())
