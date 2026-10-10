"""Dummy Bank: synthetic demo bank data. THERE IS NO REAL BANK CONNECTION.

Import rules (so nothing is double-counted):
  * Only COMPLETED demo transfers can be imported. Pending, failed and cancelled are refused.
  * Each demo transfer can be imported once (UNIQUE constraint + row lock).
  * Money in (direction=in) can only settle/create a SALE; money out only a PURCHASE/EXPENSE.
  * settle_* modes create PAYMENTS only - no new revenue or expense.
  * new_transaction creates one fully paid transaction (its payment is the bank transfer).
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.core.security import WorkspaceContext
from app.database.models import DummyBankAccount, DummyBankImport, DummyBankTransaction, Payment
from app.schemas.dummy_bank import DummyBankImportRequest, SimulateIncomingRequest
from app.schemas.payment import ContactSettlementCreate
from app.schemas.transaction import TransactionCreate
from app.services import ledger_service, payment_service, transaction_service
from app.services.ledger_service import OBLIGATION_DIRECTION
from app.utils.dates import business_tz, now_utc
from app.utils.money import to_money

BANK_NAME = "DukaanDiary Demo Bank (synthetic)"

# References are DDB-10 + suffix, e.g. DDB-100001.
# (reference suffix, direction, amount, counterparty, status, hours ago, description)
SEED_TRANSFERS = [
    ("0001", "in", "2000.00", "Ahmed Raza", "completed", 26, "IBFT from Ahmed Raza"),
    ("0002", "in", "3500.00", "Bilal Traders", "completed", 50, "Raast payment"),
    ("0003", "in", "1500.00", "Sana Ahmed", "pending", 3, "IBFT - processing"),
    ("0004", "in", "4200.00", "Usman Ali", "failed", 30, "IBFT failed - insufficient funds"),
    ("0005", "in", "900.00", "Hira Khan", "cancelled", 72, "Raast payment cancelled by sender"),
    ("0006", "out", "6000.00", "Karachi Wholesale Mart", "completed", 98, "Supplier payment"),
    ("0007", "out", "2750.00", "K-Electric", "completed", 120, "Electricity bill"),
    ("0008", "in", "7500.00", "Farooq General Store", "completed", 8, "Bulk order payment"),
]


def _account(db: Session, ctx: WorkspaceContext) -> DummyBankAccount | None:
    return db.scalar(select(DummyBankAccount).where(DummyBankAccount.workspace_id == ctx.workspace_id)
                     .order_by(DummyBankAccount.created_at).limit(1))


def ensure_seeded(db: Session, ctx: WorkspaceContext) -> DummyBankAccount:
    """Create this shop's synthetic account and sample transfers once (idempotent)."""
    account = _account(db, ctx)
    if account is not None:
        return account
    account = DummyBankAccount(workspace_id=ctx.workspace_id, bank_name=BANK_NAME,
                               account_title="My Shop (DEMO)", account_number_masked="PK00 DEMO **** 0000")
    db.add(account)
    db.flush()
    now = now_utc()
    prefix = "DDB-10"  # fixed, so demo screenshots can show the same references (e.g. DDB-100001)
    for suffix, direction, amount, name, status, hours_ago, desc in SEED_TRANSFERS:
        db.add(DummyBankTransaction(
            workspace_id=ctx.workspace_id, account_id=account.id, reference=prefix + suffix,
            direction=direction, amount=Decimal(amount), currency="PKR", counterparty_name=name,
            counterparty_account_masked="PK** **** " + suffix, description=desc, status=status,
            occurred_at=now - timedelta(hours=hours_ago)))
    db.commit()
    return account


def _imports_by_txn(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    if not ids:
        return {}
    rows = db.execute(select(DummyBankImport.dummy_bank_transaction_id, DummyBankImport.id)
                      .where(DummyBankImport.dummy_bank_transaction_id.in_(ids))).all()
    return dict(rows)


def bank_txn_out(t: DummyBankTransaction, import_id: uuid.UUID | None) -> dict:
    return {"id": t.id, "account_id": t.account_id, "reference": t.reference, "direction": t.direction,
            "amount": to_money(t.amount), "currency": t.currency.strip(), "counterparty_name": t.counterparty_name,
            "counterparty_account_masked": t.counterparty_account_masked, "description": t.description,
            "status": t.status, "occurred_at": t.occurred_at, "is_synthetic": t.is_synthetic,
            "imported": import_id is not None, "import_id": import_id}


def list_accounts(db: Session, ctx: WorkspaceContext) -> list[DummyBankAccount]:
    ensure_seeded(db, ctx)
    return list(db.scalars(select(DummyBankAccount).where(DummyBankAccount.workspace_id == ctx.workspace_id)))


def list_transactions(db: Session, ctx: WorkspaceContext, status: str | None = None,
                      direction: str | None = None, not_imported_only: bool = False) -> list[dict]:
    ensure_seeded(db, ctx)
    q = select(DummyBankTransaction).where(DummyBankTransaction.workspace_id == ctx.workspace_id)
    if status:
        q = q.where(DummyBankTransaction.status == status)
    if direction:
        q = q.where(DummyBankTransaction.direction == direction)
    rows = db.scalars(q.order_by(DummyBankTransaction.occurred_at.desc())).all()
    imports = _imports_by_txn(db, [r.id for r in rows])
    out = [bank_txn_out(r, imports.get(r.id)) for r in rows]
    return [o for o in out if not o["imported"]] if not_imported_only else out


def get_transaction(db: Session, ctx: WorkspaceContext, bank_txn_id: uuid.UUID,
                    lock: bool = False) -> DummyBankTransaction:
    q = select(DummyBankTransaction).where(DummyBankTransaction.id == bank_txn_id,
                                           DummyBankTransaction.workspace_id == ctx.workspace_id)
    if lock:
        q = q.with_for_update()
    t = db.scalar(q)
    if t is None:
        raise NotFoundError("Dummy Bank transaction not found.")
    return t


def get_transaction_out(db: Session, ctx: WorkspaceContext, bank_txn_id: uuid.UUID) -> dict:
    t = get_transaction(db, ctx, bank_txn_id)
    return bank_txn_out(t, _imports_by_txn(db, [t.id]).get(t.id))


def import_transaction(db: Session, ctx: WorkspaceContext, bank_txn_id: uuid.UUID,
                       req: DummyBankImportRequest) -> dict:
    bank = get_transaction(db, ctx, bank_txn_id, lock=True)  # serialises concurrent imports
    if bank.status != "completed":
        raise BusinessRuleError(f"This demo transfer is {bank.status}. Only completed transfers can be "
                                "recorded as money received or paid.")
    if _imports_by_txn(db, [bank.id]):
        raise ConflictError("This demo transfer has already been imported.")

    record = DummyBankImport(workspace_id=ctx.workspace_id, dummy_bank_transaction_id=bank.id,
                             mode=req.mode, imported_by=ctx.user_id)
    db.add(record)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ConflictError("This demo transfer has already been imported.")

    amount = to_money(bank.amount)
    pay_date = bank.occurred_at.astimezone(business_tz()).date()
    created_txn_id = None
    payment_ids: list[uuid.UUID] = []

    if req.mode == "settle_transaction":
        txn = transaction_service.get_transaction(db, ctx, req.transaction_id, lock=True)
        if OBLIGATION_DIRECTION[txn.type] != bank.direction:
            raise BusinessRuleError("Money received can only settle a sale; money paid out can only settle "
                                    "a purchase or expense.")
        paid, pending = ledger_service.payment_sums_for(db, txn.id)
        due = to_money(txn.amount) - paid - pending
        if amount > due:
            raise BusinessRuleError(f"This transfer ({amount:,.2f}) is more than the amount due on that record "
                                    f"({due:,.2f}).", details={"amount_due": str(due)})
        p = Payment(workspace_id=ctx.workspace_id, transaction_id=txn.id, contact_id=txn.contact_id,
                    direction=bank.direction, amount=amount, payment_date=max(pay_date, txn.transaction_date),
                    method="bank", status="completed", reference=bank.reference,
                    notes=f"Imported from Dummy Bank ({bank.reference})", dummy_bank_import_id=record.id,
                    created_by=ctx.user_id)
        db.add(p)
        db.flush()
        payment_ids = [p.id]
        message = "Recorded as a payment against the selected record. No new sale or expense was created."

    elif req.mode == "settle_contact":
        result = payment_service.settle_contact(
            db, ctx, ContactSettlementCreate(contact_id=req.contact_id, amount=amount, payment_date=pay_date,
                                             method="bank", reference=bank.reference,
                                             notes=f"Imported from Dummy Bank ({bank.reference})"),
            dummy_bank_import_id=record.id, commit=False)
        expected = "in" if result["contact"].kind == "customer" else "out"
        if expected != bank.direction:
            raise BusinessRuleError("Money received can only settle a customer's dues; money paid out only a "
                                    "supplier's dues.")
        payment_ids = [p.id for p in result["payments"]]
        message = f"Applied to {result['contact'].name}'s dues, oldest first. No new sale or expense was created."

    else:
        nt = req.new_transaction
        if OBLIGATION_DIRECTION[nt.type] != bank.direction:
            raise BusinessRuleError("Money received can only be a sale; money paid out a purchase or expense.")
        txn, _ = transaction_service.create_transaction(
            db, ctx, TransactionCreate(type=nt.type, amount=amount, amount_paid=amount, payment_method="bank",
                                       payment_reference=bank.reference, description=nt.description,
                                       category=nt.category, contact_name=nt.contact_name,
                                       transaction_date=pay_date),
            source="dummy_bank", commit=False)
        p = db.scalar(select(Payment).where(Payment.transaction_id == txn.id))
        p.dummy_bank_import_id = record.id
        p.notes = f"Imported from Dummy Bank ({bank.reference})"
        record.created_transaction_id = txn.id
        created_txn_id, payment_ids = txn.id, [p.id]
        message = f"Created a new fully paid {nt.type} from this transfer."

    db.commit()
    return {"import_id": record.id, "mode": req.mode, "dummy_bank_transaction_id": bank.id,
            "created_transaction_id": created_txn_id, "payment_ids": payment_ids, "message": message}


def simulate_incoming(db: Session, ctx: WorkspaceContext, req: SimulateIncomingRequest) -> dict:
    account = ensure_seeded(db, ctx)
    reference = (req.reference or f"DDB-SIM-{secrets.token_hex(3).upper()}").strip().upper()
    t = DummyBankTransaction(
        workspace_id=ctx.workspace_id, account_id=account.id, reference=reference, direction=req.direction,
        amount=req.amount, currency="PKR", counterparty_name=req.counterparty_name.strip(),
        counterparty_account_masked="PK** **** SIM", description=req.description or "Simulated demo transfer",
        status=req.status, occurred_at=now_utc())
    db.add(t)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(f"A demo transfer with reference {reference} already exists.")
    return bank_txn_out(t, None)


def simulate_status(db: Session, ctx: WorkspaceContext, bank_txn_id: uuid.UUID, status: str) -> dict:
    t = get_transaction(db, ctx, bank_txn_id, lock=True)
    if t.status != "pending":
        raise BusinessRuleError("Only pending demo transfers can change status.")
    t.status = status
    t.updated_at = datetime.now(timezone.utc)
    db.commit()
    return bank_txn_out(t, None)
