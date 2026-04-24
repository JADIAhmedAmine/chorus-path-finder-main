from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python import ChorusMinimalInvoiceInput, ChorusSettings, ChorusSubmissionService, InvoiceLineInput, SoumissionFacture
from chorus_python.client import ChorusUploadAttachmentResult


class FakeChorusClient:
    def __init__(self) -> None:
        self.api_calls: list[dict[str, object]] = []
        self.uploaded_paths: list[Path] = []
        self.uploaded_content: list[dict[str, str]] = []
        self.submitted_payload: dict[str, object] | None = None

    def reset_api_calls(self) -> None:
        self.api_calls = []

    def resolve_supplier_id(self, supplier_id: int | None) -> int:
        return supplier_id or 26359578

    def upload_attachment(self, pdf_path: Path) -> ChorusUploadAttachmentResult:
        self.uploaded_paths.append(pdf_path)
        return ChorusUploadAttachmentResult(
            piece_jointe_id=10851208,
            response={
                "pieceJointeId": 10851208,
                "nomFichier": pdf_path.name,
            },
        )

    def upload_attachment_content(self, *, file_name: str, file_base64: str, mime_type: str) -> ChorusUploadAttachmentResult:
        self.uploaded_content.append(
            {
                "file_name": file_name,
                "file_base64": file_base64,
                "mime_type": mime_type,
            }
        )
        return ChorusUploadAttachmentResult(
            piece_jointe_id=10851519,
            response={
                "pieceJointeId": 10851519,
                "nomFichier": file_name,
            },
        )

    def submit_invoice(self, payload: dict[str, object]) -> dict[str, str]:
        self.submitted_payload = payload
        return {
            "invoiceId": "CHORUS-TEST-001",
        }


class SoumissionFactureTest(unittest.TestCase):
    maxDiff = None

    def test_pdf_upload_then_submission_uses_soumission_facture(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient()
        service = ChorusSubmissionService(settings, fake_client)

        invoice = ChorusMinimalInvoiceInput(
            invoice_number="KLFFZ",
            recipient_code="00000000113495",
            supplier_id=26359578,
            invoice_date="2025-11-05",
            pdf_path=Path("facture.pdf"),
            lines=[
                InvoiceLineInput(
                    description="Licence",
                    unit_price_ht="16.6667",
                    quantity=1,
                    reference="votil_licence",
                    vat_rate_percent=20,
                    unit="licence",
                    discount_ht=0,
                )
            ],
        )

        result = service.submit_invoice(invoice)
        self.assertEqual(fake_client.uploaded_paths, [Path("facture.pdf")])
        self.assertEqual(result["upload"]["piece_jointe_id"], 10851208)

        expected_submission = SoumissionFacture(
            numero_facture_saisi="KLFFZ",
            date_facture="2025-11-05",
            code_destinataire="00000000113495",
            id_fournisseur=26359578,
            piece_jointe_principale_id=10851208,
            ligne_poste=[
                InvoiceLineInput(
                    description="Licence",
                    unit_price_ht="16.6667",
                    quantity=1,
                    reference="votil_licence",
                    vat_rate_percent=20,
                    unit="licence",
                    discount_ht=0,
                )
            ],
        ).to_payload()

        self.assertEqual(result["payload"], expected_submission)
        self.assertEqual(fake_client.submitted_payload, expected_submission)
        self.assertEqual(result["uploadedFiles"], [
            {
                "id": "10851208",
                "filename": "facture.pdf",
                "response": {
                    "pieceJointeId": 10851208,
                    "nomFichier": "facture.pdf",
                },
            }
        ])
        self.assertEqual(result["response"], {"invoiceId": "CHORUS-TEST-001"})

    def test_submit_prepared_payload_forces_depot_pdf_api_when_main_file_is_uploaded(self) -> None:
        settings = ChorusSettings(
            base_url="https://sandbox-api.piste.gouv.fr/cpro/factures",
            api_key="test-token",
            cpro_account="dGVzdDp0ZXN0",
            default_supplier_id=26359578,
            default_code_destinataire="00000000113495",
        )
        fake_client = FakeChorusClient()
        service = ChorusSubmissionService(settings, fake_client)

        prepared_payload = {
            "numeroFactureSaisi": "2026-003-00565",
            "dateFacture": "2026-03-16",
            "cadreDeFacturation": {
                "codeCadreFacturation": "A1_FACTURE_FOURNISSEUR",
            },
            "destinataire": {
                "codeDestinataire": "00000000380342",
            },
            "fournisseur": {
                "idFournisseur": 32242033407300,
            },
            "lignePoste": [
                {
                    "lignePosteDenomination": "Facture 2026-003-00565",
                    "lignePosteMontantRemiseHT": 0,
                    "lignePosteMontantUnitaireHT": 45903.52,
                    "lignePosteNumero": 1,
                    "lignePosteQuantite": 1,
                    "lignePosteReference": "2026-003-00565",
                    "lignePosteTauxTva": "TV12",
                    "lignePosteUnite": "UNITE",
                }
            ],
            "ligneTva": [
                {
                    "ligneTvaMontantBaseHtParTaux": 45903.52,
                    "ligneTvaMontantTvaParTaux": 9180.7,
                    "ligneTvaTaux": "TV12",
                }
            ],
            "modeDepot": "SAISIE_API",
            "montantTotal": {
                "montantAPayer": 55084.22,
                "montantHtTotal": 45903.52,
                "montantRemiseGlobaleTTC": 0,
                "montantTVA": 9180.7,
                "montantTtcTotal": 55084.22,
            },
            "numeroFactureSaisi": "2026-003-00565",
            "pieceJointePrincipale": [],
            "pieceJointeComplementaire": [],
            "references": {
                "deviseFacture": "EUR",
                "modePaiement": "ESPECE",
                "typeFacture": "FACTURE",
                "typeTva": "TVA_SUR_ENCAISSEMENT",
            },
        }

        result = service.submit_prepared_payload(
            prepared_payload,
            main_file={
                "name": "2026-003-00565 (3).pdf",
                "mimeType": "application/pdf",
                "base64": "JVBERi0xLjQK",
            },
            attachments=[],
        )

        self.assertEqual(fake_client.uploaded_content, [
            {
                "file_name": "2026-003-00565 (3).pdf",
                "file_base64": "JVBERi0xLjQK",
                "mime_type": "application/pdf",
            }
        ])
        self.assertEqual(result["payload"]["modeDepot"], "DEPOT_PDF_API")
        self.assertEqual(result["payload"]["fournisseur"]["idFournisseur"], 26359578)
        self.assertEqual(result["payload"]["pieceJointePrincipale"], [
            {
                "pieceJointePrincipaleDesignation": "GCU_MSG_01_000",
                "pieceJointePrincipaleId": 10851519,
            }
        ])
        self.assertNotIn("pieceJointeComplementaire", result["payload"])


if __name__ == "__main__":
    unittest.main()
