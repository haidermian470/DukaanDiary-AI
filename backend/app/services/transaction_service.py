"""Sales, purchases and expenses.

Creating a transaction and its first payment happens in ONE database transaction:
either both are saved or neither is.

Duplicate protection: send an `Idempotency-Key` header (any unique string per
"Save" click, e.g. crypto.randomUUID()). Sending the same key again returns the
record created the first time instead of creating a second one.
"""
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.core.security import WorkspaceContext
from app.database.models import Contact, Payment, Transaction
from app.schemas.transaction import TransactionCreate, TransactionUpdate
from app.services import contact_service, ledger_service
from app.services.ledger_service import CONTACT_KIND_FOR_TYPE, OBLIGATION_DIRECTION
from app.utils.dates import today_local
from app.utils.money import to_money

DEFAULT_CATEGORY = {"sale": "sales", "purchase": "stock", "expense": "general"}


def clean_category(category: str | None, txn_type: str) -> str:
    value = " ".join((category or "").strip().lower().replace("_", " ").split())
    return value[:60] or DEFAULT_CATEGORY[txn_type]


def _find_by_key(db: Session, workspace_id: uuid.UUID, key: str) -> Transaction | None:
    return db.scalar(select(Transaction).where(Transaction.workspace_id == workspace_id,
                                               Transaction.idempotency_key == key))


def _resolve_contact(db: Session, ctx: WorkspaceContext, txn_type: str, contact_id, contact_name,
                     contact_phone=None, is_demo=False) -> Contact | None:
    expected_kind = CONTACT_KIND_FOR_TYPE[txn_type]
    if contact_id:
        contact = contact_service.get_contact(db, ctx, contact_id)
        if contact.kind != expected_kind:
            raise BusinessRuleError(f"A {txn_type} must be linked to a {expected_kind}, "
                                    f"but '{contact.name}' is a {contact.kind}.")
        return contact
    if contact_name and contact_name.strip():
        return contact_service.find_or_create(db, ctx, expected_kind, contact_name, contact_phone, is_demo)
    return None


def _check_dates(transaction_date: date, due_date: date | None, today: date) -> None:
    if transaction_date > today:
        raise BusinessRuleError("The transaction date cannot be in the future.")
    if due_date and due_date < transaction_date:
        raise BusinessRuleError("The due date cannot be before the transaction date.")


def create_transaction(db: Session, ctx: WorkspaceContext, data: TransactionCreate,
                       idempotency_key: str | None = None, *, source: str | None = None,
                       is_demo: bool = False, commit: bool = True) -> tuple[Transaction, bool]:
    """Returns (transaction, created). created=False means an idempotent replay."""
    if idempotency_key:
        existing = _find_by_key(db, ctx.workspace_id, idempotency_key)
        if existing is not None:
            return existing, False

    today = today_local()
    txn_date = data.transaction_date or today
    _check_dates(txn_date, data.due_date, today)

    contact = _resolve_contact(db, ctx, data.type, data.contact_id, data.contact_name,
                               data.contact_phone, is_demo)
    unpaid = data.amount - data.amount_paid
    if unpaid > 0 and contact is None:
        who = "customer" if data.type == "sale" else "supplier"
        raise BusinessRuleError(
            f"Rs {unpaid:,.2f} is unpaid. Add the {who}'s name so you can track who owes this.",
            details={"missing_field": "contact_name"})

    txn = Transaction(
        workspace_id=ctx.workspace_id, type=data.type, category=clean_category(data.category, data.type),
        description=data.description.strip(), notes=data.notes, amount=data.amount, currency="PKR",
        transaction_date=txn_date, due_date=data.due_date if unpaid > 0 else None,
        contact_id=contact.id if contact else None, source=source or data.source,
        receipt_ref=data.receipt_ref, is_demo=is_demo, idempotency_key=idempotency_key,
        created_by=ctx.user_id,
    )
    db.add(txn)
    db.flush()
    if data.amount_paid > 0:
        db.add(Payment(
            workspace_id=ctx.workspace_id, transaction_id=txn.id,
            contact_id=contact.id if contact else None, direction=OBLIGATION_DIRECTION[data.type],
            amount=data.amount_paid, payment_date=txn_date, method=data.payment_method,
            status="completed", reference=data.payment_reference, is_demo=is_demo,
            notes="Paid at the time of the transaction", created_by=ctx.user_id,
        ))
    if not commit:
        db.flush()
        return txn, True
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key:  # a parallel retry with the same key won the race
            existing = _find_by_key(db, ctx.workspace_id, idempotency_key)
            if existing is not None:
                return existing, False
        raise
    return txn, True


def get_transaction(db: Session, ctx: WorkspaceContext, transaction_id: uuid.UUID,
                    lock: bool = False) -> Transaction:
    q = select(Transaction).where(Transaction.id == transaction_id,
                                  ledger_service.active_transaction_filter(ctx.workspace_id))
    if lock:
        q = q.with_for_update(of=Transaction)
    txn = db.scalar(q)
    if txn is None:
        raise NotFoundError("Transaction not found.")
    return txn


def transaction_out(db: Session, ctx: WorkspaceContext, txn: Transaction) -> dict:
    paid, pending = ledger_service.payment_sums_for(db, txn.id)
    return ledger_service.transaction_view(txn, paid, pending)


def transaction_detail(db: Session, ctx: WorkspaceContext, transaction_id: uuid.UUID) -> dict:
    txn = get_transaction(db, ctx, transaction_id)
    view = transaction_out(db, ctx, txn)
    payments = db.scalars(select(Payment).where(Payment.transaction_id == txn.id)
                          .order_by(Payment.payment_date, Payment.created_at)).all()
    view["payments"] = [ledger_service.payment_view(p, txn.contact) for p in payments]
    return view


def list_transactions(db: Session, ctx: WorkspaceContext, *, type: str | None = None,
                      category: str | None = None, settlement_status: str | None = None,
                      contact_id: uuid.UUID | None = None, contact_name: str | None = None,
                      date_from: date | None = None, date_to: date | None = None,
                      search: str | None = None, overdue_only: bool = False,
                      page: int = 1, page_size: int = 20) -> dict:
    today = today_local()
    stmt, paid, pending, outstanding = ledger_service.transactions_with_sums(ctx.workspace_id)
    if type:
        stmt = stmt.where(Transaction.type == type)
    if category:
        stmt = stmt.where(Transaction.category == clean_category(category, type or "expense"))
    if contact_id:
        stmt = stmt.where(Transaction.contact_id == contact_id)
    if contact_name:
        stmt = stmt.join(Contact, Contact.id == Transaction.contact_id).where(
            func.lower(Contact.name).like(f"%{contact_name.strip().lower()}%"))
    if date_from:
        stmt = stmt.where(Transaction.transaction_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.transaction_date <= date_to)
    if search:
        like = f"%{search.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Transaction.description).like(like),
                              func.lower(Transaction.category).like(like)))
    if settlement_status == "paid":
        stmt = stmt.where(outstanding <= 0)
    elif settlement_status == "partially_paid":
        stmt = stmt.where(outstanding > 0, paid > 0)
    elif settlement_status == "unpaid":
        stmt = stmt.where(paid <= 0)
    if overdue_only:
        stmt = stmt.where(outstanding > 0, Transaction.due_date < today)

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.execute(
        stmt.order_by(Transaction.transaction_date.desc(), Transaction.created_at.desc(), Transaction.id)
        .limit(page_size).offset((page - 1) * page_size)
    ).all()
    items = [ledger_service.transaction_view(t, p, pe, today) for t, p, pe in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "has_more": page * page_size < total}


def update_transaction(db: Session, ctx: WorkspaceContext, transaction_id: uuid.UUID,
                       data: TransactionUpdate) -> Transaction:
    txn = get_transaction(db, ctx, transaction_id, lock=True)
    fields = data.model_fields_set
    paid, pending = ledger_service.payment_sums_for(db, txn.id)

    if "amount" in fields:
        if data.amount is None:
            raise BusinessRuleError("amount cannot be empty.")
        if data.amount < paid + pending:
            raise BusinessRuleError(
                f"The amount cannot be lower than the payments already recorded (Rs {paid + pending:,.2f}).")
        txn.amount = data.amount
    if "description" in fields:
        if not data.description:
            raise BusinessRuleError("description cannot be empty.")
        txn.description = data.description.strip()
    if "category" in fields:
        txn.category = clean_category(data.category, txn.type)
    if "notes" in fields:
        txn.notes = data.notes
    if "receipt_ref" in fields:
        txn.receipt_ref = data.receipt_ref
    if "transaction_date" in fields:
        if data.transaction_date is None:
            raise BusinessRuleError("transaction_date cannot be empty.")
        txn.transaction_date = data.transaction_date
    if "due_date" in fields:
        txn.due_date = data.due_date
    _check_dates(txn.transaction_date, txn.due_date, today_local())

    if "contact_id" in fields or "contact_name" in fields:
        contact = _resolve_contact(db, ctx, txn.type, data.contact_id, data.contact_name)
        txn.contact_id = contact.id if contact else None
        # Keep the payments' contact in step with their transaction.
        for p in db.scalars(select(Payment).where(Payment.transaction_id == txn.id)):
            p.contact_id = txn.contact_id

    if to_money(txn.amount) - paid > 0 and txn.contact_id is None:
        raise BusinessRuleError("This record still has money due, so it needs a customer/supplier.")
    db.commit()
    db.refresh(txn)
    return txn


def void_transaction(db: Session, ctx: WorkspaceContext, transaction_id: uuid.UUID) -> None:
    """Soft delete. The record and its payments disappear from every total and list,
    but stay in the database for audit. Records created from a Dummy Bank import
    (or with payments imported from it) cannot be voided, so the import is never orphaned."""
    txn = get_transaction(db, ctx, transaction_id, lock=True)
    linked_import = db.scalar(select(Payment.id).where(Payment.transaction_id == txn.id,
                                                       Payment.dummy_bank_import_id.is_not(None)).limit(1))
    if linked_import is not None or txn.source == "dummy_bank":
        raise ConflictError("This record is linked to an imported Dummy Bank transaction and cannot be deleted.")
    txn.deleted_at = datetime.now(timezone.utc)
    db.commit()
