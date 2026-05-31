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
import re
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
# Métadonnées « grand public » (vue d'inspection du fichier déposé)
#
# Objectif : donner plus de visibilité à l'utilisateur sans déposer le fichier.
# On extrait, en best-effort et sans journaliser le contenu :
#   - document : taille, version PDF, pages, PDF/A, pièces jointes, propriétés ;
#   - xml      : racine, namespace, encodage du XML structuré (fichier ou embarqué) ;
#   - invoice  : en-tête de facture (numéro, dates, devise, parties, totaux).
# La source de vérité des formats/syntaxes reste l'API Chorus ; ces métadonnées
# sont purement informatives.
# ---------------------------------------------------------------------------
_XML_DECL_ENCODING_RE = re.compile(rb"<\?xml[^>]*encoding=['\"]([^'\"]+)['\"]", re.IGNORECASE)
_DATE_COMPACT_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})")
_DATE_PDF_RE = re.compile(r"(\d{4})(\d{2})(\d{2})")


def _local_of(tag: Any) -> str:
    if isinstance(tag, str):
        if tag.startswith("{"):
            return tag.partition("}")[2]
        return tag
    return ""


def _iter_descendants(element: ET.Element, local_name: str):
    for node in element.iter():
        if node is not element and _local_of(node.tag) == local_name:
            yield node


def _first_descendant(element: ET.Element | None, local_name: str) -> ET.Element | None:
    if element is None:
        return None
    return next(_iter_descendants(element, local_name), None)


def _first_child(element: ET.Element | None, local_name: str) -> ET.Element | None:
    if element is None:
        return None
    for child in list(element):
        if _local_of(child.tag) == local_name:
            return child
    return None


def _text_of(element: ET.Element | None) -> str | None:
    if element is None:
        return None
    text = (element.text or "").strip()
    return text or None


def parse_xml_tree(xml_bytes: bytes) -> ET.Element | None:
    """Parse complet (racine + enfants) avec durcissement defusedxml si dispo."""
    try:
        from defusedxml.ElementTree import fromstring as _fromstring  # type: ignore
    except Exception:  # noqa: BLE001
        _fromstring = None
    try:
        if _fromstring is not None:
            return _fromstring(xml_bytes)
        return ET.fromstring(xml_bytes)  # noqa: S314 - pas de résolution d'entités par défaut
    except Exception:  # noqa: BLE001
        return None


def _clean_meta(value: Any, *, max_length: int = 300) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_length]


def _normalize_date(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    compact = _DATE_COMPACT_RE.match(text)
    if compact:
        return f"{compact.group(1)}-{compact.group(2)}-{compact.group(3)}"
    return text[:10] if len(text) >= 10 and text[4] == "-" else text


def _normalize_amount(value: str | None) -> float | None:
    if not value:
        return None
    text = value.strip().replace(" ", "").replace(" ", "")
    if "," in text and "." not in text:
        text = text.replace(",", ".")
    try:
        return round(float(text), 2)
    except (TypeError, ValueError):
        return None


def _format_pdf_date(value: Any) -> str | None:
    if value is None:
        return None
    try:
        return value.strftime("%Y-%m-%d")  # datetime renvoyé par pypdf
    except Exception:  # noqa: BLE001
        pass
    match = _DATE_PDF_RE.search(str(value))
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    return _clean_meta(value, max_length=40)


def _pdf_document_metadata(file_bytes: bytes) -> dict[str, Any]:
    info: dict[str, Any] = {
        "pdf_version": None,
        "page_count": None,
        "pdf_a": None,
        "title": None,
        "author": None,
        "producer": None,
        "creator": None,
        "subject": None,
        "created": None,
        "modified": None,
        "attachments": [],
    }
    header = file_bytes[:16]
    if header[:5] == b"%PDF-":
        version = header[5:8].decode("ascii", "ignore").strip()
        info["pdf_version"] = version or None

    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(BytesIO(file_bytes))
        try:
            info["page_count"] = len(reader.pages)
        except Exception:  # noqa: BLE001
            pass

        meta = getattr(reader, "metadata", None)
        if meta is not None:
            info["title"] = _clean_meta(getattr(meta, "title", None))
            info["author"] = _clean_meta(getattr(meta, "author", None))
            info["producer"] = _clean_meta(getattr(meta, "producer", None))
            info["creator"] = _clean_meta(getattr(meta, "creator", None))
            info["subject"] = _clean_meta(getattr(meta, "subject", None))
            try:
                created = meta.creation_date
            except Exception:  # noqa: BLE001
                created = getattr(meta, "creation_date_raw", None)
            try:
                modified = meta.modification_date
            except Exception:  # noqa: BLE001
                modified = getattr(meta, "modification_date_raw", None)
            info["created"] = _format_pdf_date(created)
            info["modified"] = _format_pdf_date(modified)

        attachments = getattr(reader, "attachments", {}) or {}
        for name, payloads in attachments.items():
            size: int | None = None
            try:
                if payloads:
                    size = len(bytes(payloads[0]))
            except Exception:  # noqa: BLE001
                size = None
            info["attachments"].append({"name": str(name), "size_bytes": size})

        try:
            xmp = reader.xmp_metadata
            part = getattr(xmp, "pdfaid_part", None) if xmp is not None else None
            conformance = getattr(xmp, "pdfaid_conformance", None) if xmp is not None else None
            if part:
                info["pdf_a"] = f"PDF/A-{part}{(conformance or '').upper()}"
        except Exception:  # noqa: BLE001
            pass
    except Exception:  # noqa: BLE001
        pass
    return info


def _extract_ubl_invoice(root: ET.Element) -> dict[str, Any]:
    def party_fields(party: ET.Element | None) -> tuple[str | None, str | None]:
        if party is None:
            return None, None
        name = _text_of(_first_descendant(party, "RegistrationName"))
        if not name:
            party_name = _first_descendant(party, "PartyName")
            name = _text_of(_first_child(party_name, "Name"))
        ident = _text_of(_first_descendant(party, "CompanyID"))
        if not ident:
            identification = _first_descendant(party, "PartyIdentification")
            ident = _text_of(_first_child(identification, "ID"))
        return name, ident

    seller_name, seller_id = party_fields(_first_descendant(root, "AccountingSupplierParty"))
    buyer_name, buyer_id = party_fields(_first_descendant(root, "AccountingCustomerParty"))
    monetary = _first_descendant(root, "LegalMonetaryTotal")
    tax_total = _first_descendant(root, "TaxTotal")
    return {
        "invoice_number": _text_of(_first_child(root, "ID")),
        "issue_date": _normalize_date(_text_of(_first_child(root, "IssueDate"))),
        "due_date": _normalize_date(_text_of(_first_child(root, "DueDate"))),
        "currency": _text_of(_first_child(root, "DocumentCurrencyCode")),
        "seller_name": seller_name,
        "seller_id": seller_id,
        "buyer_name": buyer_name,
        "buyer_id": buyer_id,
        "total_ht": _normalize_amount(_text_of(_first_descendant(monetary, "TaxExclusiveAmount"))),
        "total_tva": _normalize_amount(_text_of(_first_child(tax_total, "TaxAmount"))),
        "total_ttc": _normalize_amount(_text_of(_first_descendant(monetary, "TaxInclusiveAmount"))),
    }


def _extract_cii_invoice(root: ET.Element) -> dict[str, Any]:
    def party_fields(party: ET.Element | None) -> tuple[str | None, str | None]:
        if party is None:
            return None, None
        name = _text_of(_first_child(party, "Name"))
        legal = _first_descendant(party, "SpecifiedLegalOrganization")
        ident = _text_of(_first_child(legal, "ID")) if legal is not None else None
        if not ident:
            ident = _text_of(_first_descendant(party, "GlobalID"))
        return name, ident

    document = _first_descendant(root, "ExchangedDocument")
    issue = _first_descendant(document, "IssueDateTime") if document is not None else None
    seller_name, seller_id = party_fields(_first_descendant(root, "SellerTradeParty"))
    buyer_name, buyer_id = party_fields(_first_descendant(root, "BuyerTradeParty"))
    summation = _first_descendant(root, "SpecifiedTradeSettlementHeaderMonetarySummation")
    payment_terms = _first_descendant(root, "SpecifiedTradePaymentTerms")
    due = _first_descendant(payment_terms, "DateTimeString") if payment_terms is not None else None
    return {
        "invoice_number": _text_of(_first_child(document, "ID")) if document is not None else None,
        "issue_date": _normalize_date(_text_of(_first_descendant(issue, "DateTimeString"))),
        "due_date": _normalize_date(_text_of(due)),
        "currency": _text_of(_first_descendant(root, "InvoiceCurrencyCode")),
        "seller_name": seller_name,
        "seller_id": seller_id,
        "buyer_name": buyer_name,
        "buyer_id": buyer_id,
        "total_ht": _normalize_amount(_text_of(_first_descendant(summation, "TaxBasisTotalAmount"))),
        "total_tva": _normalize_amount(_text_of(_first_descendant(summation, "TaxTotalAmount"))),
        "total_ttc": _normalize_amount(_text_of(_first_descendant(summation, "GrandTotalAmount"))),
    }


# Noms locaux candidats pour l'extraction générique (CPP mixte / racine inconnue).
_GENERIC_FIELD_CANDIDATES: dict[str, tuple[str, ...]] = {
    "invoice_number": ("numerofacture", "numero", "invoicenumber", "id"),
    "issue_date": ("datefacture", "dateemission", "issuedate"),
    "currency": ("devise", "codedevise", "currency", "documentcurrencycode"),
    "total_ht": ("montanthttotal", "montanttotalht", "totalht"),
    "total_tva": ("montanttva", "montanttvatotal", "totaltva"),
    "total_ttc": ("montantttctotal", "montanttotalttc", "totalttc", "montantapayer"),
}


def _extract_generic_invoice(root: ET.Element) -> dict[str, Any]:
    by_local: dict[str, str] = {}
    for node in root.iter():
        local = _local_of(node.tag).lower()
        if local and local not in by_local:
            text = (node.text or "").strip()
            if text:
                by_local[local] = text

    def pick(field: str) -> str | None:
        for candidate in _GENERIC_FIELD_CANDIDATES.get(field, ()):  # premier candidat trouvé
            if candidate in by_local:
                return by_local[candidate]
        return None

    return {
        "invoice_number": pick("invoice_number"),
        "issue_date": _normalize_date(pick("issue_date")),
        "due_date": None,
        "currency": pick("currency"),
        "seller_name": None,
        "seller_id": None,
        "buyer_name": None,
        "buyer_id": None,
        "total_ht": _normalize_amount(pick("total_ht")),
        "total_tva": _normalize_amount(pick("total_tva")),
        "total_ttc": _normalize_amount(pick("total_ttc")),
    }


def _extract_invoice_fields(structured_xml_bytes: bytes | None, detected_type: str) -> dict[str, Any] | None:
    if not structured_xml_bytes:
        return None
    root = parse_xml_tree(structured_xml_bytes)
    if root is None:
        return None
    if detected_type == UBL_INVOICE:
        invoice = _extract_ubl_invoice(root)
    elif detected_type in (CII_INVOICE, FACTURX_CII):
        invoice = _extract_cii_invoice(root)
    else:
        invoice = _extract_generic_invoice(root)
    # N'expose la section que si au moins un champ a été trouvé.
    if any(value is not None for value in invoice.values()):
        return invoice
    return None


def extract_flux_metadata(
    file_bytes: bytes,
    filename: str,
    detected: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Construit les métadonnées informatives d'un fichier de flux.

    N'appelle jamais Chorus et ne journalise aucun contenu. ``detected`` peut
    être fourni pour éviter une seconde détection ; sinon il est recalculé.
    """
    detected = detected or detect_flux_file(file_bytes, filename)
    is_pdf = bool(detected.get("is_pdf"))
    is_xml = bool(detected.get("is_xml"))

    document: dict[str, Any] = {
        "filename": filename or None,
        "extension": file_extension(filename),
        "size_bytes": len(file_bytes),
        "kind": "pdf" if is_pdf else "xml" if is_xml else "unknown",
        "encoding": None,
    }

    xml_section: dict[str, Any] | None = None
    structured_xml_bytes: bytes | None = None

    if is_pdf:
        document.update(_pdf_document_metadata(file_bytes))
        emb_name, emb_bytes = extract_embedded_invoice_xml(file_bytes)
        if emb_bytes:
            structured_xml_bytes = emb_bytes
            encoding = None
            match = _XML_DECL_ENCODING_RE.search(emb_bytes[:256])
            if match:
                encoding = match.group(1).decode("ascii", "ignore") or None
            xml_section = {
                "source": "embedded",
                "filename": emb_name or detected.get("embedded_xml_filename"),
                "root_element": detected.get("embedded_xml_root"),
                "namespace": detected.get("embedded_xml_namespace"),
                "encoding": encoding,
            }
    elif is_xml:
        structured_xml_bytes = file_bytes
        match = _XML_DECL_ENCODING_RE.search(file_bytes[:256])
        encoding = match.group(1).decode("ascii", "ignore") if match else None
        document["encoding"] = encoding
        xml_section = {
            "source": "file",
            "filename": filename or None,
            "root_element": detected.get("root_element"),
            "namespace": detected.get("namespace"),
            "encoding": encoding,
        }

    invoice = _extract_invoice_fields(structured_xml_bytes, detected.get("detected_file_type", ""))

    return {"document": document, "xml": xml_section, "invoice": invoice}


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

    # Rejets « métier » Chorus (TVA/identifiants/adresses) — analyse insensible aux accents.
    combined_noacc = combined.translate(str.maketrans("éèêëàâäîïôöùûüç", "eeeeaaaiioouuuc"))
    business_details: list[dict[str, str]] = []
    if "taxsubtotal.percent" in combined_noacc or "taxsubtotal/percent" in combined_noacc:
        business_details.append({
            "message": "Le taux de TVA est manquant dans le détail TaxSubtotal.",
            "source": "TaxTotal.TaxSubtotal.TaxCategory.Percent",
            "fix": "Ajouter cbc:Percent dans chaque TaxSubtotal.",
        })
    if "identifiant fournisseur" in combined_noacc:
        business_details.append({
            "message": "Le fournisseur indiqué dans le XML n'est pas reconnu par Chorus.",
            "source": "AccountingSupplierParty.Party.PartyIdentification.ID",
            "fix": "Utiliser le SIRET fournisseur réellement rattaché au compte technique dans Chorus qualification.",
        })
    if "demandes de paiement" in combined_noacc:
        business_details.append({
            "message": "La structure fournisseur n'est pas autorisée pour l'application Demandes de paiement.",
            "source": "AccountingSupplierParty.Party.PartyIdentification.ID",
            "fix": "Activer ou vérifier l'application Demandes de paiement pour cette structure dans Chorus.",
        })
    if "ligne d'adresse pour le fournisseur" in combined_noacc:
        business_details.append({
            "message": "L'adresse fournisseur est obligatoire dans le XML.",
            "source": "AccountingSupplierParty.Party.PostalAddress",
            "fix": "Ajouter au moins une ligne d'adresse fournisseur.",
        })
    if "ligne d'adresse pour le debiteur" in combined_noacc:
        business_details.append({
            "message": "L'adresse du débiteur/client est obligatoire dans le XML.",
            "source": "AccountingCustomerParty.Party.PostalAddress",
            "fix": "Ajouter au moins une ligne d'adresse débiteur/client.",
        })
    if "identifiant debiteur" in combined_noacc:
        business_details.append({
            "message": "Le débiteur/client indiqué dans le XML n'est pas reconnu dans Chorus.",
            "source": "AccountingCustomerParty.Party.PartyIdentification.ID",
            "fix": "Vérifier que le SIRET destinataire existe et est actif dans l'annuaire Chorus.",
        })
    if business_details:
        return {
            "category": "BUSINESS_VALIDATION",
            "message": " ".join(detail["message"] for detail in business_details),
            "source": business_details[0]["source"],
            "fix": business_details[0]["fix"],
            "details": business_details,
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
