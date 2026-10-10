"""SQLAlchemy models. They mirror `migrations/001_initial_schema.sql` exactly.

The SQL file is the source of truth for the database. If you change a table,
change the SQL migration (add a new numbered file) and this module together.
The test suite applies the real SQL file and runs every test against it,
so a mismatch between the two shows up as failing tests.
"""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, Uuid, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

Money = Numeric(14, 2)


class Base(DeclarativeBase):
    pass


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    email: Mapped[str | None] = mapped_column(Text)
    full_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(String(3), default="PKR")
    timezone: Mapped[str] = mapped_column(Text, default="Asia/Karachi")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"), primary_key=True)
    role: Mapped[str] = mapped_column(Text, default="owner")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Contact(Base):
    __tablename__ = "contacts"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    kind: Mapped[str] = mapped_column(Text)  # customer | supplier
    name: Mapped[str] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    type: Mapped[str] = mapped_column(Text)  # sale | purchase | expense
    category: Mapped[str] = mapped_column(Text, default="general")
    description: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="PKR")
    transaction_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contacts.id"))
    source: Mapped[str] = mapped_column(Text, default="manual")
    receipt_ref: Mapped[str | None] = mapped_column(Text)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    idempotency_key: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    contact: Mapped[Contact | None] = relationship(lazy="joined")


class DummyBankAccount(Base):
    __tablename__ = "dummy_bank_accounts"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    bank_name: Mapped[str] = mapped_column(Text)
    account_title: Mapped[str] = mapped_column(Text)
    account_number_masked: Mapped[str] = mapped_column(Text)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DummyBankTransaction(Base):
    __tablename__ = "dummy_bank_transactions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dummy_bank_accounts.id"))
    reference: Mapped[str] = mapped_column(Text)
    direction: Mapped[str] = mapped_column(Text)  # in | out (relative to the shop's account)
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="PKR")
    counterparty_name: Mapped[str] = mapped_column(Text)
    counterparty_account_masked: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)  # completed | pending | failed | cancelled
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())


class DummyBankImport(Base):
    __tablename__ = "dummy_bank_imports"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    dummy_bank_transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dummy_bank_transactions.id"))
    mode: Mapped[str] = mapped_column(Text)
    created_transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transactions.id"))
    imported_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id"))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transactions.id"))
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contacts.id"))
    direction: Mapped[str] = mapped_column(Text)  # in | out
    amount: Mapped[Decimal] = mapped_column(Money)
    payment_date: Mapped[date] = mapped_column(Date)
    method: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="completed")
    reference: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    dummy_bank_import_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("dummy_bank_imports.id"))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    idempotency_key: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now())


class PaymentVerification(Base):
    __tablename__ = "payment_verifications"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    outcome: Mapped[str] = mapped_column(Text)
    confidence: Mapped[str] = mapped_column(Text)
    extracted: Mapped[dict] = mapped_column(JSONB)
    comparison: Mapped[list] = mapped_column(JSONB)
    explanation: Mapped[str] = mapped_column(Text)
    matched_dummy_bank_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("dummy_bank_transactions.id"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
