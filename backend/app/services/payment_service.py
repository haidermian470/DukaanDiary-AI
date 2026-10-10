"""Payments: settling sales (money in) and purchases/expenses (money out).

Safety rules:
  * The transaction row is locked (SELECT ... FOR UPDATE) before checking the
    balance, so two simultaneous payments cannot both squeeze past the limit.
  * completed + pending payments can never exceed the transaction amount.
  * Settling a due creates a PAYMENT only - never a new sale or expense.
  * Payments imported from the Dummy Bank are read-only.
"""
import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.core.security import WorkspaceContext
from app.database.models import Contact, Payment, Transaction
from app.schemas.payment import ContactSettlementCreate, PaymentCreate, PaymentUpdate
from app.services import contact_service, ledger_service
from app.services.ledger_service import OBLIGATION_DIRECTION
from app.services.transaction_service import get_transaction
from app.utils.dates import today_local
from app.utils.money import ZERO, to_money

ALLOWED_STATUS_CHANGES = {
    "pending": {"completed", "failed", "cancelled"},
    "completed": {"cancelled"},   # reversal, e.g. a bounced cheque
    "failed": set(),
    "cancelled": set(),
}


def _by_key(db: Session, workspace_id: uuid.UUID, key: str) -> Payment | None:
    return db.scalar(select(Payment).where(Payment.workspace_id == workspace_id,
                                           Payment.idempotency_key == key))


def _contact_for(db: Session, payment: Payment) -> Contact | None:
    return db.get(Contact, payment.contact_id) if payment.contact_id else None


def payment_out(db: Session, payment: Payment) -> dict:
    return ledger_service.payment_view(payment, _contact_for(db, payment))


def _check_payment_date(payment_date: date, txn: Transaction | None) -> None:
    if payment_date > today_local():
        raise BusinessRuleError("The payment date cannot be in the future.")
    if txn is not None and payment_date < txn.transaction_date:
        raise BusinessRuleError("A payment cannot be dated before the record it settles. "
                                "Record it as an advance instead.")


def _check_room(txn: Transaction, paid, pending, new_amount, verb="settle") -> None:
    room = to_money(txn.amount) - paid - pending
    if new_amount > room:
        raise BusinessRuleError(
            f"This payment (Rs {new_amount:,.2f}) is more than the amount still due (Rs {room:,.2f}).",
            details={"amount_due": str(room), "already_paid": str(paid), "pending": str(pending)})


def create_payment(db: Session, ctx: WorkspaceContext, data: PaymentCreate,
                   idempotency_key: str | None = None) -> tuple[Payment, bool]:
    if idempotency_key:
        existing = _by_key(db, ctx.workspace_id, idempotency_key)
        if existing is not None:
            return existing, False

    payment_date = data.payment_date or today_local()
    if data.is_advance:
        contact = contact_service.get_contact(db, ctx, data.contact_id)
        _check_payment_date(payment_date, None)
        payment = Payment(
            workspace_id=ctx.workspace_id, transaction_id=None, contact_id=contact.id,
            direction="in" if contact.kind == "customer" else "out", amount=data.amount,
            payment_date=payment_date, method=data.method, status=data.status,
            reference=data.reference, notes=data.notes or "Advance", idempotency_key=idempotency_key,
            created_by=ctx.user_id)
    else:
        txn = get_transaction(db, ctx, data.transaction_id, lock=True)
        if data.contact_id and data.contact_id != txn.contact_id:
            raise BusinessRuleError("contact_id does not match the transaction's customer/supplier.")
        _check_payment_date(payment_date, txn)
        paid, pending = ledger_service.payment_sums_for(db, txn.id)
        _check_room(txn, paid, pending, data.amount)
        payment = Payment(
            workspace_id=ctx.workspace_id, transaction_id=txn.id, contact_id=txn.contact_id,
            direction=OBLIGATION_DIRECTION[txn.type], amount=data.amount, payment_date=payment_date,
            method=data.method, status=data.status, reference=data.reference, notes=data.notes,
            idempotency_key=idempotency_key, created_by=ctx.user_id)
    db.add(payment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key and (existing := _by_key(db, ctx.workspace_id, idempotency_key)):
            return existing, False
        raise
    return payment, True


def resolve_settlement_contact(db: Session, ctx: WorkspaceContext, contact_id=None, contact_name=None,
                               kind=None) -> Contact:
    if contact_id:
        return contact_service.get_contact(db, ctx, contact_id)
    matches = contact_service.find_by_name(db, ctx.workspace_id, contact_name, kind)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise BusinessRuleError(f"'{contact_name}' is both a customer and a supplier. Say which one.",
                                details={"choices": [{"id": str(c.id), "kind": c.kind} for c in matches]})
    similar = contact_service.search_similar(db, ctx.workspace_id, contact_name, kind)
    raise NotFoundError(
        f"No {kind or 'customer or supplier'} named '{contact_name}' was found.",
        details={"did_you_mean": [{"id": str(c.id), "name": c.name, "kind": c.kind} for c in similar]})


def settle_contact(db: Session, ctx: WorkspaceContext, data: ContactSettlementCreate,
                   idempotency_key: str | None = None, *, dummy_bank_import_id=None,
                   commit: bool = True) -> dict:
    """Apply one payment to a contact's open records, oldest due first (FIFO).

    Creates one payment row per record it touches. Never creates a sale or expense.
    """
    contact = resolve_settlement_contact(db, ctx, data.contact_id, data.contact_name, data.kind)

    if idempotency_key:
        previous = db.scalars(select(Payment).where(
            Payment.workspace_id == ctx.workspace_id,
            Payment.idempotency_key.like(f"{idempotency_key}:%")).order_by(Payment.idempotency_key)).all()
        if previous:
            total = sum((to_money(p.amount) for p in previous), ZERO)
            out_after = ledger_service.contact_balances(db, ctx.workspace_id, contact_ids=[contact.id])[0]["outstanding"]
            return {"contact": contact, "amount_applied": total, "outstanding_before": out_after + total,
                    "outstanding_after": out_after, "payments": previous, "replayed": True}

    # Lock every open record of this contact before reading balances.
    db.execute(select(Transaction.id).where(
        ledger_service.active_transaction_filter(ctx.workspace_id),
        Transaction.contact_id == contact.id).with_for_update())
    obligations = ledger_service.open_obligations(db, ctx.workspace_id, contact.id)
    outstanding_before = sum((o["transaction"].amount - o["paid"] for o in obligations), ZERO)
    available = sum((o["available"] for o in obligations), ZERO)
    if available <= 0:
        raise BusinessRuleError(f"{contact.name} has no outstanding balance to settle. "
                                "Record this as an advance if money was paid in advance.")
    if data.amount > available:
        owner = "owes you" if contact.kind == "customer" else "is owed"
        raise BusinessRuleError(
            f"{contact.name} {owner} Rs {available:,.2f}, which is less than Rs {data.amount:,.2f}. "
            "Record the extra as an advance, or correct the amount.",
            details={"outstanding": str(available)})

    payment_date = data.payment_date or today_local()
    if payment_date > today_local():
        raise BusinessRuleError("The payment date cannot be in the future.")

    remaining = data.amount
    created = []
    for index, item in enumerate(obligations):
        if remaining <= 0:
            break
        share = min(remaining, item["available"])
        if share <= 0:
            continue
        txn = item["transaction"]
        p = Payment(
            workspace_id=ctx.workspace_id, transaction_id=txn.id, contact_id=contact.id,
            direction=OBLIGATION_DIRECTION[txn.type], amount=share,
            payment_date=max(payment_date, txn.transaction_date), method=data.method,
            status="completed", reference=data.reference,
            notes=data.notes or f"Settlement against '{txn.description}'",
            dummy_bank_import_id=dummy_bank_import_id,
            idempotency_key=f"{idempotency_key}:{index:03d}" if idempotency_key else None,
            created_by=ctx.user_id)
        db.add(p)
        created.append(p)
        remaining -= share

    if commit:
        db.commit()
    else:
        db.flush()
    return {"contact": contact, "amount_applied": data.amount, "outstanding_before": outstanding_before,
            "outstanding_after": outstanding_before - data.amount, "payments": created, "replayed": False}


def settlement_out(db: Session, result: dict) -> dict:
    c = result["contact"]
    return {"contact": {"id": c.id, "name": c.name, "kind": c.kind},
            "amount_applied": result["amount_applied"], "outstanding_before": result["outstanding_before"],
            "outstanding_after": result["outstanding_after"],
            "payments": [ledger_service.payment_view(p, c) for p in result["payments"]]}


def get_payment(db: Session, ctx: WorkspaceContext, payment_id: uuid.UUID, lock: bool = False) -> Payment:
    q = select(Payment).where(Payment.id == payment_id, Payment.workspace_id == ctx.workspace_id)
    if lock:
        q = q.with_for_update()
    payment = db.scalar(q)
    if payment is None:
        raise NotFoundError("Payment not found.")
    if payment.transaction_id:
        txn = db.get(Transaction, payment.transaction_id)
        if txn is None or txn.deleted_at is not None:
            raise NotFoundError("Payment not found (its record was deleted).")
    return payment


def update_payment(db: Session, ctx: WorkspaceContext, payment_id: uuid.UUID, data: PaymentUpdate) -> Payment:
    payment = get_payment(db, ctx, payment_id, lock=True)
    fields = data.model_fields_set
    money_fields = {"status", "amount", "payment_date"} & fields
    if payment.dummy_bank_import_id and money_fields:
        raise ConflictError("Payments imported from the Dummy Bank cannot be changed.")

    txn = None
    if payment.transaction_id:
        txn = get_transaction(db, ctx, payment.transaction_id, lock=True)

    if ("amount" in fields or "payment_date" in fields) and payment.status != "pending":
        raise BusinessRuleError("Amount and date can only be changed while a payment is pending. "
                                "Cancel it and record a new one instead.")
    if "amount" in fields and data.amount is not None:
        payment.amount = data.amount
    if "payment_date" in fields and data.payment_date is not None:
        _check_payment_date(data.payment_date, txn)
        payment.payment_date = data.payment_date

    if "status" in fields and data.status and data.status != payment.status:
        if data.status not in ALLOWED_STATUS_CHANGES[payment.status]:
            raise BusinessRuleError(f"A {payment.status} payment cannot be changed to {data.status}.")
        payment.status = data.status

    # Re-check the limit if this payment still counts towards the transaction.
    if txn is not None and payment.status in ("completed", "pending"):
        paid, pending = ledger_service.payment_sums_for(db, txn.id, exclude_payment_id=payment.id)
        _check_room(txn, paid, pending, to_money(payment.amount))

    if "method" in fields and data.method:
        payment.method = data.method
    if "reference" in fields:
        payment.reference = data.reference
    if "notes" in fields:
        payment.notes = data.notes
    db.commit()
    db.refresh(payment)
    return payment


def list_payments(db: Session, ctx: WorkspaceContext, *, transaction_id=None, contact_id=None, status=None,
                  direction=None, date_from=None, date_to=None, page: int = 1, page_size: int = 20) -> dict:
    stmt = (select(Payment).outerjoin(Transaction, Transaction.id == Payment.transaction_id)
            .where(Payment.workspace_id == ctx.workspace_id,
                   (Payment.transaction_id.is_(None)) | (Transaction.deleted_at.is_(None))))
    if transaction_id:
        stmt = stmt.where(Payment.transaction_id == transaction_id)
    if contact_id:
        stmt = stmt.where(Payment.contact_id == contact_id)
    if status:
        stmt = stmt.where(Payment.status == status)
    if direction:
        stmt = stmt.where(Payment.direction == direction)
    if date_from:
        stmt = stmt.where(Payment.payment_date >= date_from)
    if date_to:
        stmt = stmt.where(Payment.payment_date <= date_to)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Payment.payment_date.desc(), Payment.created_at.desc(), Payment.id)
                      .limit(page_size).offset((page - 1) * page_size)).all()
    return {"items": [payment_out(db, p) for p in rows], "total": total, "page": page,
            "page_size": page_size, "has_more": page * page_size < total}
