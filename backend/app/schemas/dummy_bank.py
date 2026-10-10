import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.common import ApiModel, MoneyPositive, PaymentStatus, TransactionType

DEMO_DISCLAIMER = "DEMO - NO REAL BANK CONNECTION. All Dummy Bank data is synthetic."


class DummyBankAccountOut(ApiModel):
    id: uuid.UUID
    bank_name: str
    account_title: str
    account_number_masked: str
    is_synthetic: bool
    disclaimer: str = DEMO_DISCLAIMER


class DummyBankTransactionOut(ApiModel):
    id: uuid.UUID
    account_id: uuid.UUID
    reference: str
    direction: Literal["in", "out"]
    amount: Decimal
    currency: str
    counterparty_name: str
    counterparty_account_masked: str | None
    description: str | None
    status: PaymentStatus
    occurred_at: datetime
    is_synthetic: bool
    imported: bool
    import_id: uuid.UUID | None
    disclaimer: str = DEMO_DISCLAIMER


class NewTransactionFromBank(ApiModel):
    type: TransactionType
    description: str = Field(min_length=1, max_length=500)
    category: str | None = Field(default=None, max_length=60)
    contact_name: str | None = Field(default=None, max_length=120)


class DummyBankImportRequest(ApiModel):
    """How should this bank entry be recorded? Choose ONE mode.

    - settle_transaction: it pays an existing sale/purchase/expense (no new revenue/expense is created)
    - settle_contact: it pays a customer's/supplier's dues, oldest first
    - new_transaction: it is a brand-new, fully paid sale/purchase/expense
    """
    mode: Literal["settle_transaction", "settle_contact", "new_transaction"]
    transaction_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    new_transaction: NewTransactionFromBank | None = None

    @model_validator(mode="after")
    def _mode_fields(self):
        if self.mode == "settle_transaction" and not self.transaction_id:
            raise ValueError("settle_transaction needs transaction_id.")
        if self.mode == "settle_contact" and not self.contact_id:
            raise ValueError("settle_contact needs contact_id.")
        if self.mode == "new_transaction" and not self.new_transaction:
            raise ValueError("new_transaction needs the new_transaction details.")
        return self


class DummyBankImportResult(ApiModel):
    import_id: uuid.UUID
    mode: str
    dummy_bank_transaction_id: uuid.UUID
    created_transaction_id: uuid.UUID | None
    payment_ids: list[uuid.UUID]
    message: str
    disclaimer: str = DEMO_DISCLAIMER


class SimulateIncomingRequest(ApiModel):
    """Demo control: make a synthetic transfer 'arrive' in the Dummy Bank (e.g. a delayed transfer)."""
    amount: MoneyPositive
    counterparty_name: str = Field(min_length=1, max_length=120)
    reference: str | None = Field(default=None, min_length=3, max_length=64,
                                  description="Leave empty to auto-generate a DDB-... reference")
    direction: Literal["in", "out"] = "in"
    status: Literal["completed", "pending"] = "completed"
    description: str | None = Field(default=None, max_length=200)


class SimulateStatusRequest(ApiModel):
    """Demo control: a pending synthetic transfer completes or fails."""
    status: Literal["completed", "failed", "cancelled"]
