#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python import ChorusMinimalInvoiceInput, ChorusSubmissionService, InvoiceLineInput, load_chorus_settings


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prépare et soumet une facture Chorus Pro minimale, avec le flux PDF signé quand un PDF est fourni."
    )
    parser.add_argument("--invoice-number", required=True, help="Numéro de facture à envoyer dans numeroFactureSaisi.")
    parser.add_argument("--recipient-code", help="codeDestinataire Chorus.")
    parser.add_argument("--service-code", help="codeServiceExecutant Chorus.")
    parser.add_argument("--supplier-id", type=int, help="idFournisseur Chorus (ignore: valeur fixee a 26359578).")
    parser.add_argument("--bank-account-code", type=int, help="codeCoordonneesBancairesFournisseur.")
    parser.add_argument("--invoice-date", help="Date facture au format ISO (YYYY-MM-DD).")
    parser.add_argument("--comment", help="Commentaire libre ajouté au payload.")
    parser.add_argument("--pdf", type=Path, help="Chemin vers le PDF à uploader avant soumission.")
    parser.add_argument("--pdf-designation", help="Nom fonctionnel de la pièce jointe dans le payload final.")
    parser.add_argument("--line-description", default="Test facture", help="Libellé de la ligne de facture.")
    parser.add_argument("--line-reference", default="TEST001", help="Référence de la ligne de facture.")
    parser.add_argument("--unit-price-ht", default="20.00", help="Montant unitaire HT.")
    parser.add_argument("--quantity", default="1", help="Quantité de la ligne.")
    parser.add_argument("--vat-rate", default="20", help="Taux TVA en pourcentage.")
    parser.add_argument("--vat-code", help="Code TVA Chorus forcé. Si absent, le script tente de le résoudre via API.")
    parser.add_argument("--dry-run", action="store_true", help="Construit le payload sans appeler /factures/v1/soumettre.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    settings = load_chorus_settings()
    service = ChorusSubmissionService(settings)

    invoice = ChorusMinimalInvoiceInput(
        invoice_number=args.invoice_number,
        recipient_code=args.recipient_code,
        service_executant_code=args.service_code,
        supplier_id=args.supplier_id,
        bank_account_code=args.bank_account_code,
        invoice_date=args.invoice_date,
        comment=args.comment,
        pdf_path=args.pdf,
        pdf_designation=args.pdf_designation,
        lines=[
            InvoiceLineInput(
                description=args.line_description,
                unit_price_ht=args.unit_price_ht,
                quantity=args.quantity,
                reference=args.line_reference,
                vat_rate_percent=args.vat_rate,
                manual_tva_code=args.vat_code,
            )
        ],
    )

    if args.dry_run:
        payload = service.prepare_payload(invoice)
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    result = service.submit_invoice(invoice)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
