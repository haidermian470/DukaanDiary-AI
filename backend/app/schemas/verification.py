import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from app.schemas.common import ApiModel
from app.schemas.dummy_bank import DEMO_DISCLAIMER

Outcome = Literal["matched_demo_record", "pending_or_delayed", "mismatch", "unverified", "potentially_suspicious"]


class AIScreenshotExtraction(BaseModel):
    """What Gemini reads from a payment screenshot. Every field may be null."""
    is_payment_screenshot: bool
    amount: float | None
    currency: str | None
    reference: str | None
    transaction_datetime: str | None
    sender_name: str | None
    recipient_name: str | None
    status_text: str | None
    status_category: Literal["success", "pending", "failed", "unknown"] | None
    service_name: str | None
    legibility: Literal["clear", "partial", "poor"] | None
    unreadable_fields: list[str]
    notes: str | None


class FieldComparison(ApiModel):
    field: str
    screenshot_value: str | None
    record_value: str | None
    result: Literal["match", "mismatch", "not_available", "close"]
    note: str | None = None


class VerificationResult(ApiModel):
    id: uuid.UUID | None
    outcome: Outcome
    outcome_label: str
    confidence: Literal["high", "medium", "low"]
    extracted: dict
    matched_record_id: uuid.UUID | None
    matched_record_reference: str | None
    already_imported: bool
    comparisons: list[FieldComparison]
    explanation: str
    recommended_action: str
    disclaimer: str = DEMO_DISCLAIMER
    proves_real_payment: Literal[False] = False


class AIReceiptLineItem(BaseModel):
    name: str | None
    quantity: float | None
    unit_price: float | None
    line_total: float | None


class AIReceiptExtraction(BaseModel):
    is_receipt_like: bool
    document_kind: Literal["receipt", "invoice", "quotation", "bill", "unknown"] | None
    merchant_name: str | None
    receipt_date: str | None
    total_amount: float | None
    currency: str | None
    tax_amount: float | None
    line_items: list[AIReceiptLineItem]
    payment_method_shown: Literal["cash", "bank", "mobile_wallet", "cheque", "other"] | None
    paid_marking_visible: bool | None
    suggested_category: str | None
    unreadable_fields: list[str]
    notes: str | None


class ReceiptLineItem(ApiModel):
    name: str | None
    quantity: float | None
    unit_price: Decimal | None
    line_total: Decimal | None


class ReceiptAnalysis(ApiModel):
    document_kind: str | None
    merchant_name: str | None
    receipt_date: date | None
    total_amount: Decimal | None
    currency: str | None
    tax_amount: Decimal | None
    line_items: list[ReceiptLineItem]
    payment_method_shown: str | None
    paid_marking_visible: bool | None
    unreadable_fields: list[str]
    warnings: list[str]
    draft: dict
    saved: Literal[False] = False
    note: str = ("A receipt or invoice does not prove that money was paid. Review the draft, set how much "
                 "was actually paid, then save it with POST /api/v1/transactions.")


class VerificationHistoryItem(ApiModel):
    id: uuid.UUID
    outcome: Outcome
    confidence: str
    explanation: str
    matched_dummy_bank_transaction_id: uuid.UUID | None
    created_at: datetime
