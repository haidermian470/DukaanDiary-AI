import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import ApiModel, MoneyPositive, PaymentMethod, PaymentStatus
from app.schemas.contact import ContactRef


class PaymentCreate(ApiModel):
    """Record money received for a sale, or paid for a purchase/expense.

    - Normal case: give `transaction_id`. The payment settles that record (fully or partly).
    - Advance: set `is_advance=true` and give `contact_id` (money paid before any bill exists).
    """
    transaction_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    is_advance: bool = False
    amount: MoneyPositive
    payment_date: date | None = Field(default=None, description="Defaults to today (Asia/Karachi)")
    method: PaymentMethod = "cash"
    status: Literal["completed", "pending"] = "completed"
    reference: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _target(self):
        if self.is_advance:
            if not self.contact_id or self.transaction_id:
                raise ValueError("An advance needs contact_id and no transaction_id.")
        elif not self.transaction_id:
            raise ValueError("Give transaction_id, or set is_advance=true with a contact_id.")
        return self


class ContactSettlementCreate(ApiModel):
    """'Ahmed paid 2,000 against his previous dues.'

    The amount is applied to the contact's open records, oldest due first.
    """
    contact_id: uuid.UUID | None = None
    contact_name: str | None = Field(default=None, max_length=120)
    kind: Literal["customer", "supplier"] | None = Field(
        default=None, description="Helps find the contact by name. Required if the name exists as both.")
    amount: MoneyPositive
    payment_date: date | None = None
    method: PaymentMethod = "cash"
    reference: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _who(self):
        if not self.contact_id and not (self.contact_name and self.contact_name.strip()):
            raise ValueError("Give contact_id or contact_name.")
        return self


class PaymentUpdate(ApiModel):
    """Status changes allowed: pending -> completed | failed | cancelled, and completed -> cancelled (reversal).
    Amount and date can only change while the payment is pending."""
    status: PaymentStatus | None = None
    amount: MoneyPositive | None = None
    payment_date: date | None = None
    method: PaymentMethod | None = None
    reference: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=1000)


class PaymentOut(ApiModel):
    id: uuid.UUID
    transaction_id: uuid.UUID | None
    contact: ContactRef | None
    direction: Literal["in", "out"] = Field(description="in = money received, out = money paid")
    amount: Decimal
    payment_date: date
    method: PaymentMethod
    status: PaymentStatus
    reference: str | None
    notes: str | None
    is_advance: bool
    from_dummy_bank: bool
    is_demo: bool
    created_at: datetime


class SettlementResult(ApiModel):
    contact: ContactRef
    amount_applied: Decimal
    outstanding_before: Decimal
    outstanding_after: Decimal
    payments: list[PaymentOut]
