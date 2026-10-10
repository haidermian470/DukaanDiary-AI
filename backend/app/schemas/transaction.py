import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import (
    ApiModel, MoneyNonNegative, MoneyPositive, PaymentMethod, SettlementStatus, TransactionType,
)
from app.schemas.contact import ContactRef
from app.schemas.payment import PaymentOut


class TransactionCreate(ApiModel):
    """Create a sale, purchase or expense.

    `amount` is the full value of the deal. `amount_paid` is the money that changed
    hands right now. Example: "sold goods worth 5,000, received 3,000"
    -> amount=5000, amount_paid=3000. The remaining 2,000 becomes a receivable.
    """
    type: TransactionType
    amount: MoneyPositive
    amount_paid: MoneyNonNegative = Field(
        description="Money received (sale) or paid (purchase/expense) now. 0 for fully on credit.")
    payment_method: PaymentMethod | None = Field(default=None, description="Required when amount_paid > 0")
    payment_reference: str | None = Field(default=None, max_length=100)
    description: str = Field(min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=2000)
    transaction_date: date | None = Field(default=None, description="Defaults to today (Asia/Karachi)")
    due_date: date | None = Field(default=None, description="When the unpaid part is due")
    contact_id: uuid.UUID | None = None
    contact_name: str | None = Field(default=None, max_length=120,
                                     description="Finds the customer/supplier by name, or creates it")
    contact_phone: str | None = Field(default=None, max_length=30)
    source: Literal["manual", "ai", "voice", "receipt"] = "manual"
    receipt_ref: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _rules(self):
        if self.amount_paid > self.amount:
            raise ValueError("amount_paid cannot be more than amount. Record an advance separately.")
        if self.amount_paid > 0 and not self.payment_method:
            raise ValueError("payment_method is required when amount_paid is more than 0.")
        if self.due_date and self.transaction_date and self.due_date < self.transaction_date:
            raise ValueError("due_date cannot be before transaction_date.")
        if self.contact_id and self.contact_name:
            raise ValueError("Give contact_id or contact_name, not both.")
        return self


class TransactionUpdate(ApiModel):
    """Edit a record. The type cannot change: void it and create a new one instead.
    Send a field as null to clear it (due_date, notes, contact)."""
    description: str | None = Field(default=None, min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=2000)
    amount: MoneyPositive | None = None
    transaction_date: date | None = None
    due_date: date | None = None
    contact_id: uuid.UUID | None = None
    contact_name: str | None = Field(default=None, max_length=120)
    receipt_ref: str | None = Field(default=None, max_length=500)


class TransactionOut(ApiModel):
    id: uuid.UUID
    type: TransactionType
    category: str
    description: str
    notes: str | None
    amount: Decimal
    currency: str
    transaction_date: date
    due_date: date | None
    contact: ContactRef | None
    source: str
    receipt_ref: str | None
    is_demo: bool
    amount_paid: Decimal = Field(description="Sum of COMPLETED payments only")
    amount_pending: Decimal = Field(description="Sum of pending payments (not counted as paid)")
    outstanding: Decimal = Field(description="amount - amount_paid")
    settlement_status: SettlementStatus
    is_overdue: bool
    created_at: datetime
    updated_at: datetime


class TransactionDetail(TransactionOut):
    payments: list[PaymentOut]
