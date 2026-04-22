from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path


def decimal_value(value: Decimal | str | float | int) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


@dataclass(slots=True)
class InvoiceLineInput:
    description: str
    unit_price_ht: Decimal | str | float | int
    quantity: Decimal | str | float | int = Decimal("1")
    reference: str = "TEST001"
    vat_rate_percent: Decimal | str | float | int = Decimal("20")
    unit: str = "UNITE"
    discount_ht: Decimal | str | float | int = Decimal("0")
    manual_tva_code: str | None = None

    @property
    def unit_price_decimal(self) -> Decimal:
        return decimal_value(self.unit_price_ht)

    @property
    def quantity_decimal(self) -> Decimal:
        return decimal_value(self.quantity)

    @property
    def vat_rate_decimal(self) -> Decimal:
        return decimal_value(self.vat_rate_percent)

    @property
    def discount_decimal(self) -> Decimal:
        return decimal_value(self.discount_ht)


@dataclass(slots=True)
class ChorusMinimalInvoiceInput:
    invoice_number: str
    recipient_code: str | None = None
    service_executant_code: str | None = None
    supplier_id: int | None = None
    bank_account_code: int | None = None
    invoice_date: date | str | None = None
    comment: str | None = None
    pdf_path: Path | None = None
    pdf_designation: str | None = None
    lines: list[InvoiceLineInput] = field(default_factory=list)
