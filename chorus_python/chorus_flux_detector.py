"""Détection du format réel d'un fichier + compatibilité avec la syntaxeFlux.

Objectif : éviter les rejets Chorus du type
« cvc-elt.1.a: Cannot find the declaration of element 'CPPFacturePivot' »
en analysant la structure réelle du fichier (racine XML ou XML Factur-X embarqué
dans un PDF/A3) AVANT d'appeler ``/v1/deposer/flux``.

Les valeurs autorisées de format/syntaxe restent fournies par Chorus
(``/v1/recuperer/formatflux`` et ``/v1/recuperer/syntaxeflux``) : ce module ne
fait que détecter le type du fichier, calculer une compatibilité indicative et
expliquer les rejets.

Sécurité : aucun contenu de fichier n'est journalisé. Le parsing XML utilise
``defusedxml`` si disponible, sinon le parseur standard sans résolution
d'entités externes.
"""

from __future__ import annotations

import os
import xml.etree.ElementTree as ET
from io import BytesIO
from typing import Any


# ---------------------------------------------------------------------------
# Types détectés
# ---------------------------------------------------------------------------
UBL_INVOICE = "UBL_INVOICE"
CII_INVOICE = "CII_INVOICE"
CPP_FACTURE_MIXTE = "CPP_FACTURE_MIXTE"
FACTURX_CII = "FACTURX_CII"
CHORUS_PIVOT_OUTPUT = "CHORUS_PIVOT_OUTPUT"
CHORUS_LIFECYCLE_STATUS_OUTPUT = "CHORUS_LIFECYCLE_STATUS_OUTPUT"
PDF_GENERIC = "PDF_GENERIC"
UNKNOWN_XML = "UNKNOWN_XML"
INVALID_XML = "INVALID_XML"

DEPOSIT_COMPATIBLE_TYPES = frozenset(
    {UBL_INVOICE, CII_INVOICE, CPP_FACTURE_MIXTE, FACTURX_CII}
)

# Types de sortie Chorus : jamais déposables, jamais forçables.
HARD_BLOCK_TYPES = frozenset(
    {CHORUS_PIVOT_OUTPUT, CHORUS_LIFECYCLE_STATUS_OUTPUT, PDF_GENERIC, INVALID_XML}
)

SEVERITY_OK = "OK"
SEVERITY_WARNING = "WARNING"
SEVERITY_BLOCKING = "BLOCKING"

_INVOICE_ATTACHMENT_NAMES = frozenset(
    {"factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml", "order-x.xml"}
)

SCHEMA_MISMATCH_PHRASE = "cannot find the declaration of element"

# Syntaxes de référence par type (repli si Chorus ne renvoie pas de liste).
_STATIC_RECOMMENDED: dict[str, list[str]] = {
    UBL_INVOICE: [
        "IN_DP_E1_UBL_INVOICE",
        "IN_DP_E2_UBL_INVOICE_MIN",
        "IN_DP_E3_UBL_INVOICE",
        "IN_DP_E4_UBL_INVOICE_FACTURES_TRAVAUX",
        "IN_DP_E5_UBL_INVOICE_MIN_FACTURES_TRAVAUX",
    ],
    CII_INVOICE: [
        "IN_DP_E1_CII_16B",
        "IN_DP_E2_CII_MIN_16B",
        "IN_DP_E2_CII_MIN",
    ],
    FACTURX_CII: [
        "IN_DP_E2_CII_FACTURX",
        "IN_DP_E5_CII_FACTURX_FACTURES_TRAVAUX",
        "IN_DP_E2_CII_FACTURX_FE",
    ],
    CPP_FACTURE_MIXTE: [
        "IN_DP_E2_CPP_FACTURE_MIN",
    ],
}


# ---------------------------------------------------------------------------
# Guide des formats (référentiel statique pour l'UI ; la source de vérité des
# valeurs réellement disponibles reste l'API Chorus formatflux/syntaxeflux).
# ---------------------------------------------------------------------------
FLUX_FORMAT_GUIDE: list[dict[str, Any]] = [
    {
        "code": "FSO1100A", "label": "UBL Invoice structuré E1", "typeFlux": "IN_DEPOT_DP",
        "formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_UBL_INVOICE",
        "expectedFile": "XML", "expectedRoot": "Invoice",
        "expectedNamespace": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
        "detectedType": UBL_INVOICE, "supportLevel": "supported", "depositCompatible": True,
    },
    {
        "code": "FSO1106A", "label": "CII 16B structuré E1", "typeFlux": "IN_DEPOT_DP",
        "formatFlux": "IN_DP_E1_STRUCT", "syntaxeFlux": "IN_DP_E1_CII_16B",
        "expectedFile": "XML", "expectedRoot": "CrossIndustryInvoice",
        "detectedType": CII_INVOICE, "supportLevel": "supported", "depositCompatible": True,
    },
    {
        "code": "FSO1110A", "label": "UBL Invoice minimal E2", "typeFlux": "IN_DEPOT_DP",
        "formatFlux": "IN_DP_E2_MIXTE", "syntaxeFlux": "IN_DP_E2_UBL_INVOICE_MIN",
        "expectedFile": "XML", "expectedRoot": "Invoice",
        "detectedType": UBL_INVOICE, "supportLevel": "supported", "depositCompatible": True,
    },
    {
        "code": "FSO1113A", "label": "CPP Facture mixte E2", "typeFlux": "IN_DEPOT_DP",
        "formatFlux": "IN_DP_E2_MIXTE", "syntaxeFlux": "IN_DP_E2_CPP_FACTURE_MIN",
        "expectedFile": "XML", "expectedRoot": "CPPFactureMixte",
        "detectedType": CPP_FACTURE_MIXTE, "supportLevel": "supported", "depositCompatible": True,
    },
    {
        "code": "FSO1116A", "label": "CII 16B minimal E2", "typeFlux": "IN_DEPOT_DP",
        "formatFlux": "IN_DP_E2_MIXTE", "syntaxeFlux": "IN_DP_E2_CII_MIN_16B",
        "expectedFile": "XML", "expectedRoot": "CrossIndustryInvoice",
        "detectedType": CII_INVOICE, "supportLevel": "supported", "depositCompatible": True,
    },
    {
        "code": "FSO1117A", "label": "Factur-X E2", "typeFlux": "IN_DEPOT_DP",
        "formatFlux": "IN_DP_E2_FACTURX", "syntaxeFlux": "IN_DP_E2_CII_FACTURX",
        "expectedFile": "PDF/A3", "expectedEmbeddedXml": "factur-x.xml",
        "expectedEmbeddedRoot": "CrossIndustryInvoice",
        "detectedType": FACTURX_CII, "supportLevel": "supported", "depositCompatible": True,
    },
    {
        "code": "FSO1120A", "label": "UBL mémoire E3", "typeFlux": "IN_DEPOT_DP",
        "formatFlux": "IN_DP_E3_STRUCT", "syntaxeFlux": "IN_DP_E3_UBL_INVOICE",
        "expectedFile": "XML", "expectedRoot": "Invoice",
        "detectedType": UBL_INVOICE, "supportLevel": "optional", "depositCompatible": True,
    },
    {
        "code": "FEN0036A", "label": "CPPFacturePivot sortie Chorus S", "typeFlux": "OUT_RECEPT_DP",
        "formatFlux": "OUT_DP_PIVOT_S", "syntaxeFlux": "OUT_DP_CPP_FACTURE",
        "expectedRoot": "CPPFacturePivot",
        "detectedType": CHORUS_PIVOT_OUTPUT, "supportLevel": "detect_only", "depositCompatible": False,
    },
    {
        "code": "FEN1200A", "label": "CPPStatut cycle de vie R", "typeFlux": "OUT_RECEPT_CDV",
        "formatFlux": "OUT_CDV_XML", "syntaxeFlux": "OUT_CDV_CPP_STATUT",
        "expectedRoot": "CPPStatut",
        "detectedType": CHORUS_LIFECYCLE_STATUS_OUTPUT, "supportLevel": "detect_only", "depositCompatible": False,
    },
]


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------
MSG_PIVOT = (
    "Ce fichier semble être un flux pivot Chorus sortant (CPPFacturePivot). "
    "Il ne doit pas être redéposé via /v1/deposer/flux."
)
MSG_STATUT = (
    "Ce fichier semble être un flux retour de cycle de vie (CPPStatut). "
    "Ce n'est pas une facture à déposer."
)
MSG_PDF_GENERIC = (
    "Le PDF ne contient pas de XML Factur-X embarqué (factur-x.xml). Il n'est "
    "pas déposable en flux ; utilisez le dépôt unitaire PDF si nécessaire."
)
MSG_INVALID_XML = "Le fichier n'est pas un XML valide et ne peut pas être analysé. Chorus le rejettera."
MSG_UBL_MISMATCH = (
    "Le fichier est un XML UBL Invoice, mais la syntaxe sélectionnée ne semble "
    "pas être une syntaxe UBL."
)
MSG_CII_MISMATCH = (
    "Le fichier est un XML CII, mais la syntaxe sélectionnée ne semble pas être "
    "une syntaxe CII."
)
MSG_CII_AS_FACTURX = (
    "Le fichier est un XML CII brut (et non un PDF Factur-X) : une syntaxe "
    "Factur-X attend un PDF/A3 avec XML embarqué."
)
MSG_FACTURX_MISMATCH = (
    "Le fichier est un PDF Factur-X avec un XML embarqué. Utilisez une syntaxe "
    "Factur-X comme IN_DP_E2_CII_FACTURX si elle est disponible."
)
MSG_CPP_MISMATCH = (
    "Le fichier est un XML CPPFactureMixte : sélectionnez une syntaxe CPP "
    "(ex. IN_DP_E2_CPP_FACTURE_MIN) renvoyée par Chorus."
)
MSG_UNKNOWN_XML = (
    "Racine XML non reconnue : impossible de garantir la compatibilité avec la "
    "syntaxe sélectionnée. Vérifiez le fichier avant de forcer le dépôt."
)


# ---------------------------------------------------------------------------
# Parsing XML (root only)
# ---------------------------------------------------------------------------
def _local_and_namespace(tag: str) -> tuple[str, str]:
    if tag.startswith("{"):
        namespace, _, local = tag[1:].partition("}")
        return local, namespace
    return tag, ""


def parse_xml_root(xml_bytes: bytes) -> tuple[str | None, str]:
    """Retourne (nom_local_racine, namespace) ou (None, '') si XML invalide."""
    try:
        from defusedxml.ElementTree import fromstring as _fromstring  # type: ignore
    except Exception:  # noqa: BLE001 - durcissement optionnel
        _fromstring = None

    if _fromstring is not None:
        try:
            root = _fromstring(xml_bytes)
            tag = root.tag if isinstance(root.tag, str) else ""
            return _local_and_namespace(tag)
        except Exception:  # noqa: BLE001
            return None, ""

    # Repli : parseur standard, sans résolution d'entités externes (par défaut).
    parser = ET.XMLPullParser(events=("start",))
    try:
        parser.feed(xml_bytes)
        for _event, element in parser.read_events():
            tag = element.tag if isinstance(element.tag, str) else ""
            return _local_and_namespace(tag)
    except ET.ParseError:
        return None, ""
    return None, ""


def classify_xml_root(root_local: str | None) -> str:
    if not root_local:
        return INVALID_XML
    lowered = root_local.lower()
    if lowered == "invoice":
        return UBL_INVOICE
    if "crossindustryinvoice" in lowered:
        return CII_INVOICE
    if "cppfacturemixte" in lowered:
        return CPP_FACTURE_MIXTE
    if "cppfacturepivot" in lowered:
        return CHORUS_PIVOT_OUTPUT
    if "cppstatut" in lowered:
        return CHORUS_LIFECYCLE_STATUS_OUTPUT
    return UNKNOWN_XML


# ---------------------------------------------------------------------------
# Extraction XML embarqué dans un PDF (Factur-X / ZUGFeRD / Order-X)
# ---------------------------------------------------------------------------
def _is_invoice_attachment(name: str) -> bool:
    lowered = name.lower()
    return lowered in _INVOICE_ATTACHMENT_NAMES or "factur-x" in lowered or "zugferd" in lowered


def extract_embedded_invoice_xml(file_bytes: bytes) -> tuple[str | None, bytes | None]:
    """Best-effort : retourne (nom, contenu) du XML de facture embarqué dans le PDF."""
    # 1) pypdf si disponible (préféré).
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(BytesIO(file_bytes))
        attachments = getattr(reader, "attachments", {}) or {}
        for name, payloads in attachments.items():
            if _is_invoice_attachment(str(name)) and payloads:
                return str(name), bytes(payloads[0])
        for name, payloads in attachments.items():
            if str(name).lower().endswith(".xml") and payloads:
                return str(name), bytes(payloads[0])
        return None, None
    except Exception:  # noqa: BLE001 - on tente le repli
        pass

    # 2) Repli PyMuPDF (fitz).
    document = None
    try:
        import fitz  # type: ignore

        document = fitz.open(stream=file_bytes, filetype="pdf")
        names = list(document.embfile_names())
        chosen = next((n for n in names if _is_invoice_attachment(n)), None)
        if chosen is None:
            chosen = next((n for n in names if n.lower().endswith(".xml")), None)
        if chosen is not None:
            return chosen, bytes(document.embfile_get(chosen))
    except Exception:  # noqa: BLE001
        return None, None
    finally:
        if document is not None:
            try:
                document.close()
            except Exception:  # noqa: BLE001
                pass
    return None, None


def _looks_like_pdf(file_bytes: bytes) -> bool:
    return file_bytes[:5] == b"%PDF-"


def _looks_like_xml(file_bytes: bytes) -> bool:
    head = file_bytes[:256].lstrip().lstrip(b"\xef\xbb\xbf").lstrip()
    return head[:1] == b"<"


# ---------------------------------------------------------------------------
# Détection principale
# ---------------------------------------------------------------------------
def detect_flux_file(file_bytes: bytes, filename: str) -> dict[str, Any]:
    """Analyse un fichier et retourne sa nature (sans contenu journalisé)."""
    lower = (filename or "").lower()
    detected: dict[str, Any] = {
        "detected_file_type": UNKNOWN_XML,
        "root_element": None,
        "namespace": None,
        "is_pdf": False,
        "is_xml": False,
        "is_facturx": False,
        "embedded_xml_filename": None,
        "embedded_xml_root": None,
        "embedded_xml_namespace": None,
        "is_deposit_compatible": False,
        "warnings": [],
    }

    is_pdf = lower.endswith(".pdf") or (not lower.endswith(".xml") and _looks_like_pdf(file_bytes))
    is_xml = lower.endswith(".xml") or (not is_pdf and _looks_like_xml(file_bytes))

    if is_pdf:
        detected["is_pdf"] = True
        emb_name, emb_bytes = extract_embedded_invoice_xml(file_bytes)
        if emb_bytes:
            emb_root, emb_ns = parse_xml_root(emb_bytes)
            detected["embedded_xml_filename"] = emb_name
            detected["embedded_xml_root"] = emb_root
            detected["embedded_xml_namespace"] = emb_ns or None
            if emb_root and "crossindustryinvoice" in emb_root.lower():
                detected["detected_file_type"] = FACTURX_CII
                detected["is_facturx"] = True
            else:
                detected["detected_file_type"] = PDF_GENERIC
                detected["warnings"].append(MSG_PDF_GENERIC)
        else:
            detected["detected_file_type"] = PDF_GENERIC
            detected["warnings"].append(MSG_PDF_GENERIC)
    elif is_xml:
        detected["is_xml"] = True
        root_local, namespace = parse_xml_root(file_bytes)
        detected["root_element"] = root_local
        detected["namespace"] = namespace or None
        detected["detected_file_type"] = classify_xml_root(root_local)
    else:
        detected["detected_file_type"] = UNKNOWN_XML

    dtype = detected["detected_file_type"]
    detected["is_deposit_compatible"] = dtype in DEPOSIT_COMPATIBLE_TYPES

    if dtype == CHORUS_PIVOT_OUTPUT:
        detected["warnings"].append(MSG_PIVOT)
    elif dtype == CHORUS_LIFECYCLE_STATUS_OUTPUT:
        detected["warnings"].append(MSG_STATUT)
    elif dtype == INVALID_XML:
        detected["warnings"].append(MSG_INVALID_XML)

    return detected


# ---------------------------------------------------------------------------
# Compatibilité détecté ↔ syntaxeFlux
# ---------------------------------------------------------------------------
def _family_filter(detected_type: str):
    if detected_type == UBL_INVOICE:
        return lambda s: "UBL" in s
    if detected_type == CII_INVOICE:
        return lambda s: "CII" in s and "FACTURX" not in s
    if detected_type == FACTURX_CII:
        return lambda s: "FACTURX" in s
    if detected_type == CPP_FACTURE_MIXTE:
        return lambda s: "CPP" in s
    return None


def recommended_syntaxes(
    detected_type: str,
    allowed_syntaxes_for_format: list[str] | None = None,
) -> list[str]:
    family = _family_filter(detected_type)
    if allowed_syntaxes_for_format and family is not None:
        live = [s for s in allowed_syntaxes_for_format if family(s.upper())]
        if live:
            return live
    return list(_STATIC_RECOMMENDED.get(detected_type, []))


def evaluate_flux_compatibility(
    detected_file_type: str,
    selected_format_flux: str | None,
    selected_syntaxe_flux: str | None,
    allowed_syntaxes_for_format: list[str] | None = None,
) -> dict[str, Any]:
    """Évalue la compatibilité fichier détecté ↔ syntaxe sélectionnée."""
    syntaxe = (selected_syntaxe_flux or "").strip()
    syntaxe_upper = syntaxe.upper()
    recommended = recommended_syntaxes(detected_file_type, allowed_syntaxes_for_format)

    def result(compatible: bool | None, severity: str, warning: str | None) -> dict[str, Any]:
        return {
            "formatFlux": selected_format_flux,
            "syntaxeFlux": selected_syntaxe_flux,
            "compatible": compatible,
            "severity": severity,
            "recommendedSyntaxes": recommended,
            "warning": warning,
        }

    # Types de sortie Chorus / PDF générique / XML invalide : blocage dur.
    if detected_file_type == CHORUS_PIVOT_OUTPUT:
        return result(False, SEVERITY_BLOCKING, MSG_PIVOT)
    if detected_file_type == CHORUS_LIFECYCLE_STATUS_OUTPUT:
        return result(False, SEVERITY_BLOCKING, MSG_STATUT)
    if detected_file_type == PDF_GENERIC:
        return result(False, SEVERITY_BLOCKING, MSG_PDF_GENERIC)
    if detected_file_type == INVALID_XML:
        return result(False, SEVERITY_BLOCKING, MSG_INVALID_XML)

    # Racine inconnue : avertissement forçable.
    if detected_file_type == UNKNOWN_XML:
        return result(False, SEVERITY_WARNING, MSG_UNKNOWN_XML)

    # Pas encore de syntaxe sélectionnée : pas de blocage, indéterminé.
    if not syntaxe:
        return result(None, SEVERITY_OK, None)

    if detected_file_type == UBL_INVOICE:
        if "UBL" in syntaxe_upper:
            return result(True, SEVERITY_OK, None)
        return result(False, SEVERITY_BLOCKING, MSG_UBL_MISMATCH)

    if detected_file_type == CII_INVOICE:
        if "FACTURX" in syntaxe_upper:
            return result(False, SEVERITY_BLOCKING, MSG_CII_AS_FACTURX)
        if "CII" in syntaxe_upper:
            return result(True, SEVERITY_OK, None)
        return result(False, SEVERITY_BLOCKING, MSG_CII_MISMATCH)

    if detected_file_type == FACTURX_CII:
        if "FACTURX" in syntaxe_upper:
            return result(True, SEVERITY_OK, None)
        return result(False, SEVERITY_BLOCKING, MSG_FACTURX_MISMATCH)

    if detected_file_type == CPP_FACTURE_MIXTE:
        if "CPP" in syntaxe_upper:
            return result(True, SEVERITY_OK, None)
        return result(False, SEVERITY_BLOCKING, MSG_CPP_MISMATCH)

    return result(None, SEVERITY_WARNING, MSG_UNKNOWN_XML)


# ---------------------------------------------------------------------------
# Explication des erreurs / rejets Chorus
# ---------------------------------------------------------------------------
def explain_chorus_flux_error(
    raw_response: Any,
    detected: dict[str, Any] | None = None,
    http_status: int | None = None,
    code_retour: int | None = None,
    libelle: str | None = None,
) -> dict[str, Any] | None:
    """Renvoie {category, message} expliquant un rejet/erreur, ou None."""
    text_parts = [libelle]
    if isinstance(raw_response, (dict, list)):
        import json

        text_parts.append(json.dumps(raw_response, ensure_ascii=False))
    elif raw_response is not None:
        text_parts.append(str(raw_response))
    combined = " ".join(part for part in text_parts if part).lower()

    if SCHEMA_MISMATCH_PHRASE in combined:
        return {
            "category": "SCHEMA_MISMATCH",
            "message": "La structure du fichier XML ne correspond pas à la syntaxe/au schéma sélectionné(e).",
        }
    if "cppfacturepivot" in combined:
        return {
            "category": "PIVOT_OUTPUT",
            "message": "Le XML déposé semble être un flux pivot Chorus sortant, et non un fichier d'entrée de dépôt de facture.",
        }
    if http_status == 401:
        return {
            "category": "AUTH",
            "message": "Authentification échouée. Vérifiez le token PISTE et l'en-tête cpro-account.",
        }
    if http_status == 403:
        return {
            "category": "FORBIDDEN",
            "message": (
                "Accès refusé (403) par Chorus. Le compte technique (cpro-account) n'est pas habilité "
                "au dépôt de flux : la structure doit disposer d'un raccordement EDI « dépôt de flux » et "
                "le compte doit porter le rôle « Gestionnaire de flux » sur cette structure. "
                "(Le mode « saisie API » utilisé par la soumission unitaire ne suffit pas.) "
                "Vérifiez aussi que l'application PISTE est abonnée à l'API Chorus Pro dans le bon environnement."
            ),
        }
    if http_status == 415:
        return {
            "category": "UNSUPPORTED_MEDIA_TYPE",
            "message": "Format de requête non supporté : le backend doit envoyer du JSON application/json;charset=utf-8 à Chorus.",
        }
    if code_retour is not None and code_retour != 0:
        message = f"Chorus a renvoyé codeRetour={code_retour}."
        if libelle:
            message += f" Libellé : {libelle}."
        return {"category": "CODE_RETOUR", "message": message}
    return None


def file_extension(filename: str | None) -> str:
    if not filename:
        return ""
    return os.path.splitext(filename)[1].lower()
