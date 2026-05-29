from __future__ import annotations

import re
import sys
import unittest
from decimal import Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from chorus_python.extraction import extract_pdf_text_pdfplumber


FIXTURES_DIR = REPO_ROOT / "src" / "test" / "data_test"
FILENAME_PATTERN = re.compile(r"^facture_test_(\d{2})_(\d{14})\.pdf$")

INVOICE_NUMBER_PATTERN = re.compile(r"\bTEST-2025-\d{5}\b")
INVOICE_DATE_PATTERN = re.compile(r"\bdu\s+(\d{2}/\d{2}/\d{4})\b", re.IGNORECASE)
SUPPLIER_SIRET_PATTERN = re.compile(
    r"\bSiret\s*:\s*254\s*402\s*530\s*00011\b", re.IGNORECASE
)
RECIPIENT_CODE_PATTERN = re.compile(
    r"\bCode\s+Destinataire\s*:\s*(\d{14})\b", re.IGNORECASE
)
TOTAL_HT_PATTERN = re.compile(r"\bTotal\s+HT\s+([\d\s.,]+?)\s*$", re.IGNORECASE | re.MULTILINE)
TOTAL_TVA_PATTERN = re.compile(r"\bTVA\s+\d{1,2}%\s+([\d\s.,]+?)\s*$", re.IGNORECASE | re.MULTILINE)
TOTAL_TTC_PATTERN = re.compile(r"\bTotal\s+TTC\s+([\d\s.,]+?)\s*$", re.IGNORECASE | re.MULTILINE)


def _parse_decimal(text: str) -> Decimal:
    cleaned = text.strip().replace(" ", "").replace(" ", "")
    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    return Decimal(cleaned)


def _discover_fixtures() -> list[tuple[str, str, Path]]:
    fixtures: list[tuple[str, str, Path]] = []
    for path in sorted(FIXTURES_DIR.glob("facture_test_*.pdf")):
        match = FILENAME_PATTERN.match(path.name)
        if not match:
            continue
        fixtures.append((match.group(1), match.group(2), path))
    return fixtures


class PdfExtractionE2ETest(unittest.TestCase):
    """End-to-end extraction tests on all invoice fixtures in src/test/data_test.

    Strict mode: every fixture must yield 100% of the required fields
    (invoice number, date, supplier SIRET, recipient code, HT/TVA/TTC totals).
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.fixtures = _discover_fixtures()
        if not cls.fixtures:
            raise unittest.SkipTest(f"No invoice fixtures found in {FIXTURES_DIR}")

    def test_fixtures_directory_is_populated(self) -> None:
        self.assertGreaterEqual(
            len(self.fixtures),
            10,
            f"Expected at least 10 invoice fixtures in {FIXTURES_DIR}, "
            f"found {len(self.fixtures)}.",
        )

    def test_every_fixture_yields_required_fields(self) -> None:
        failures: list[str] = []

        for index, expected_recipient_code, pdf_path in self.fixtures:
            with self.subTest(invoice=index, pdf=pdf_path.name):
                try:
                    text = extract_pdf_text_pdfplumber(pdf_path)
                except Exception as exc:
                    failures.append(f"{pdf_path.name}: extraction raised {exc!r}")
                    continue

                missing: list[str] = []

                invoice_number = INVOICE_NUMBER_PATTERN.search(text)
                if not invoice_number:
                    missing.append("invoice_number")
                elif not invoice_number.group(0).endswith(index):
                    failures.append(
                        f"{pdf_path.name}: invoice number "
                        f"{invoice_number.group(0)} does not end with {index}"
                    )

                if not INVOICE_DATE_PATTERN.search(text):
                    missing.append("invoice_date")

                if not SUPPLIER_SIRET_PATTERN.search(text):
                    missing.append("supplier_siret")

                recipient_match = RECIPIENT_CODE_PATTERN.search(text)
                if not recipient_match:
                    missing.append("recipient_code")
                elif recipient_match.group(1) != expected_recipient_code:
                    failures.append(
                        f"{pdf_path.name}: recipient code "
                        f"{recipient_match.group(1)} != filename {expected_recipient_code}"
                    )

                total_ht = TOTAL_HT_PATTERN.search(text)
                total_tva = TOTAL_TVA_PATTERN.search(text)
                total_ttc = TOTAL_TTC_PATTERN.search(text)
                if not total_ht:
                    missing.append("total_ht")
                if not total_tva:
                    missing.append("total_tva")
                if not total_ttc:
                    missing.append("total_ttc")

                if missing:
                    failures.append(f"{pdf_path.name}: missing fields {missing}")
                    continue

                ht = _parse_decimal(total_ht.group(1))
                tva = _parse_decimal(total_tva.group(1))
                ttc = _parse_decimal(total_ttc.group(1))
                if (ht + tva) != ttc:
                    failures.append(
                        f"{pdf_path.name}: HT ({ht}) + TVA ({tva}) != TTC ({ttc})"
                    )

        self.assertFalse(
            failures,
            "Strict extraction failures (must be 0):\n  - " + "\n  - ".join(failures),
        )

    def test_extraction_is_idempotent_per_fixture(self) -> None:
        sample_index, _, sample_path = self.fixtures[0]
        first = extract_pdf_text_pdfplumber(sample_path)
        second = extract_pdf_text_pdfplumber(sample_path)
        self.assertEqual(
            first,
            second,
            f"Extraction of {sample_path.name} is non-deterministic.",
        )


if __name__ == "__main__":
    unittest.main()
