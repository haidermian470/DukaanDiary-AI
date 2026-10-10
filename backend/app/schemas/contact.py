import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel, ContactKind, PaymentStatus


class ContactRef(ApiModel):
    id: uuid.UUID
    name: str
    kind: ContactKind


class ContactCreate(ApiModel):
    kind: ContactKind
    name: str = Field(min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=30,
                              description="Optional. Used for WhatsApp reminder links, e.g. 03001234567")
    notes: str | None = Field(default=None, max_length=1000)


class ContactUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    notes: str | None = Field(default=None, max_length=1000)


class ContactOut(ApiModel):
    id: uuid.UUID
    kind: ContactKind
    name: str
    phone: str | None
    notes: str | None
    is_demo: bool
    created_at: datetime


class ContactBalance(ContactOut):
    """A customer's receivable or a supplier's payable, derived from records."""
    total_billed: Decimal = Field(description="Sales to this customer, or purchases/expenses from this supplier")
    total_settled: Decimal = Field(description="Completed payments against those records")
    outstanding: Decimal = Field(description="Still owed (customer owes you / you owe supplier)")
    overdue_amount: Decimal
    is_overdue: bool
    earliest_due_date: date | None
    open_items: int
    advance_balance: Decimal = Field(description="Completed advances not tied to a specific record")


class LedgerEntry(ApiModel):
    date: date
    entry_type: Literal["sale", "purchase", "expense", "payment", "advance"]
    description: str
    amount: Decimal
    effect: Decimal = Field(description="Change to the running balance (+ increases what is owed)")
    running_balance: Decimal
    status: PaymentStatus | None = None
    transaction_id: uuid.UUID | None = None
    payment_id: uuid.UUID | None = None


class ContactLedger(ApiModel):
    contact: ContactBalance
    entries: list[LedgerEntry]
    note: str = ("Running balance = records billed minus completed payments (including advances). "
                 "Pending, failed and cancelled payments are listed but do not change the balance.")
