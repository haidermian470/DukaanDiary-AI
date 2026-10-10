"""The accounting engine: every balance and total in the app is calculated here.

Rules (also in backend/README.md):
  * A transaction (sale / purchase / expense) is an obligation for `amount`.
  * Only COMPLETED payments count as money received or paid.
    Pending, failed and cancelled payments are ignored by every total.
  * outstanding(transaction) = amount - completed payments against it.
  * Receivables = outstanding on sales.  Payables = outstanding on purchases + expenses.
  * Voided (soft-deleted) transactions, and payments attached to them, are ignored everywhere.
  * Advances (payments with no transaction) count as cash in/out, and are shown separately
    on the contact. They are not subtracted from receivables/payables automatically.

The dashboard, reports, ledgers and the AI assistant all call these functions,
so they always agree with each other.
"""
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.database.models import Contact, Payment, Transaction
from app.utils.dates import Period, today_local
from app.utils.money import ZERO, to_money

OBLIGATION_DIRECTION = {"sale": "in", "purchase": "out", "expense": "out"}
CONTACT_KIND_FOR_TYPE = {"sale": "customer", "purchase": "supplier", "expense": "supplier"}
RECEIVABLE_TYPES = ("sale",)
PAYABLE_TYPES = ("purchase", "expense")


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------
def payment_sums_subquery(workspace_id: uuid.UUID):
    """Per transaction: total of completed payments and total of pending payments."""
    return (
        select(
            Payment.transaction_id.label("transaction_id"),
            func.coalesce(func.sum(case((Payment.status == "completed", Payment.amount), else_=0)), 0)
            .label("paid"),
            func.coalesce(func.sum(case((Payment.status == "pending", Payment.amount), else_=0)), 0)
            .label("pending"),
        )
        .where(Payment.workspace_id == workspace_id, Payment.transaction_id.is_not(None))
        .group_by(Payment.transaction_id)
        .subquery("payment_sums")
    )


def active_transaction_filter(workspace_id: uuid.UUID):
    return and_(Transaction.workspace_id == workspace_id, Transaction.deleted_at.is_(None))


def transactions_with_sums(workspace_id: uuid.UUID):
    """SELECT Transaction, paid, pending - plus the column expressions for filtering."""
    sums = payment_sums_subquery(workspace_id)
    paid = func.coalesce(sums.c.paid, 0)
    pending = func.coalesce(sums.c.pending, 0)
    outstanding = Transaction.amount - paid
    stmt = (
        select(Transaction, paid.label("paid"), pending.label("pending"))
        .outerjoin(sums, sums.c.transaction_id == Transaction.id)
        .where(active_transaction_filter(workspace_id))
    )
    return stmt, paid, pending, outstanding


def settlement_status(amount: Decimal, paid: Decimal) -> str:
    if paid >= amount:
        return "paid"
    if paid > 0:
        return "partially_paid"
    return "unpaid"


def transaction_view(txn: Transaction, paid, pending, today: date | None = None) -> dict:
    """Plain dict matching schemas.transaction.TransactionOut."""
    today = today or today_local()
    paid, pending = to_money(paid), to_money(pending)
    outstanding = to_money(txn.amount) - paid
    contact = txn.contact
    return {
        "id": txn.id, "type": txn.type, "category": txn.category, "description": txn.description,
        "notes": txn.notes, "amount": to_money(txn.amount), "currency": txn.currency.strip(),
        "transaction_date": txn.transaction_date, "due_date": txn.due_date,
        "contact": ({"id": contact.id, "name": contact.name, "kind": contact.kind} if contact else None),
        "source": txn.source, "receipt_ref": txn.receipt_ref, "is_demo": txn.is_demo,
        "amount_paid": paid, "amount_pending": pending, "outstanding": outstanding,
        "settlement_status": settlement_status(to_money(txn.amount), paid),
        "is_overdue": bool(outstanding > 0 and txn.due_date and txn.due_date < today),
        "created_at": txn.created_at, "updated_at": txn.updated_at,
    }


def payment_view(p: Payment, contact: Contact | None) -> dict:
    return {
        "id": p.id, "transaction_id": p.transaction_id,
        "contact": ({"id": contact.id, "name": contact.name, "kind": contact.kind} if contact else None),
        "direction": p.direction, "amount": to_money(p.amount), "payment_date": p.payment_date,
        "method": p.method, "status": p.status, "reference": p.reference, "notes": p.notes,
        "is_advance": p.transaction_id is None, "from_dummy_bank": p.dummy_bank_import_id is not None,
        "is_demo": p.is_demo, "created_at": p.created_at,
    }


def payment_sums_for(db: Session, transaction_id: uuid.UUID, exclude_payment_id: uuid.UUID | None = None):
    """(completed_total, pending_total) for one transaction."""
    conditions = [Payment.transaction_id == transaction_id]
    if exclude_payment_id:
        conditions.append(Payment.id != exclude_payment_id)
    row = db.execute(
        select(
            func.coalesce(func.sum(case((Payment.status == "completed", Payment.amount), else_=0)), 0),
            func.coalesce(func.sum(case((Payment.status == "pending", Payment.amount), else_=0)), 0),
        ).where(*conditions)
    ).one()
    return to_money(row[0]), to_money(row[1])


def _counted_payments_filter(workspace_id: uuid.UUID):
    """Completed payments that are not attached to a voided transaction."""
    return and_(
        Payment.workspace_id == workspace_id,
        Payment.status == "completed",
        or_(Payment.transaction_id.is_(None), Transaction.deleted_at.is_(None)),
    )


# ---------------------------------------------------------------------------
# Period totals (flows)
# ---------------------------------------------------------------------------
def total_by_type(db: Session, workspace_id: uuid.UUID, period: Period) -> dict[str, Decimal]:
    rows = db.execute(
        select(Transaction.type, func.coalesce(func.sum(Transaction.amount), 0), func.count())
        .where(active_transaction_filter(workspace_id),
               Transaction.transaction_date.between(period.start, period.end))
        .group_by(Transaction.type)
    ).all()
    totals = {"sale": ZERO, "purchase": ZERO, "expense": ZERO}
    counts = {"sale": 0, "purchase": 0, "expense": 0}
    for t, total, count in rows:
        totals[t] = to_money(total)
        counts[t] = count
    return {"totals": totals, "counts": counts}


def money_moved(db: Session, workspace_id: uuid.UUID, period: Period) -> dict[str, Decimal]:
    """Completed money in and out within the period (by payment date)."""
    rows = db.execute(
        select(Payment.direction, func.coalesce(func.sum(Payment.amount), 0))
        .outerjoin(Transaction, Transaction.id == Payment.transaction_id)
        .where(_counted_payments_filter(workspace_id),
               Payment.payment_date.between(period.start, period.end))
        .group_by(Payment.direction)
    ).all()
    result = {"in": ZERO, "out": ZERO}
    for direction, total in rows:
        result[direction] = to_money(total)
    return result


def money_received_breakdown(db: Session, workspace_id: uuid.UUID, period: Period) -> dict[str, Decimal]:
    """Split money received into: paid at the time of sales in this period, dues collected
    for older sales, and advances. Used to explain 'why is cash lower than sales'."""
    rows = db.execute(
        select(
            case(
                (Payment.transaction_id.is_(None), "advances"),
                (Transaction.transaction_date >= period.start, "for_sales_in_period"),
                else_="for_older_sales",
            ).label("bucket"),
            func.coalesce(func.sum(Payment.amount), 0),
        )
        .outerjoin(Transaction, Transaction.id == Payment.transaction_id)
        .where(_counted_payments_filter(workspace_id), Payment.direction == "in",
               Payment.payment_date.between(period.start, period.end))
        .group_by("bucket")
    ).all()
    result = {"for_sales_in_period": ZERO, "for_older_sales": ZERO, "advances": ZERO}
    for bucket, total in rows:
        result[bucket] = to_money(total)
    return result


def expense_by_category(db: Session, workspace_id: uuid.UUID, period: Period,
                        types: tuple[str, ...] = ("expense",)) -> list[dict]:
    rows = db.execute(
        select(Transaction.category, func.sum(Transaction.amount), func.count())
        .where(active_transaction_filter(workspace_id), Transaction.type.in_(types),
               Transaction.transaction_date.between(period.start, period.end))
        .group_by(Transaction.category)
        .order_by(func.sum(Transaction.amount).desc(), Transaction.category)
    ).all()
    grand = sum((to_money(r[1]) for r in rows), ZERO)
    return [
        {"category": cat, "total": to_money(total), "count": count,
         "share_percent": (float(round(to_money(total) / grand * 100, 1)) if grand > 0 else 0.0)}
        for cat, total, count in rows
    ]


# ---------------------------------------------------------------------------
# Balances (as of today, not period-filtered)
# ---------------------------------------------------------------------------
def outstanding_totals(db: Session, workspace_id: uuid.UUID, today: date | None = None) -> dict:
    today = today or today_local()
    stmt, paid, pending, outstanding = transactions_with_sums(workspace_id)
    sums = stmt.with_only_columns(
        Transaction.type,
        func.coalesce(func.sum(outstanding), 0),
        func.coalesce(func.sum(case((and_(Transaction.due_date < today, outstanding > 0), outstanding),
                                    else_=0)), 0),
        func.count(Transaction.id).filter(outstanding > 0),
        func.count(Transaction.id).filter(and_(Transaction.due_date < today, outstanding > 0)),
    ).group_by(Transaction.type)
    result = {"receivables": ZERO, "payables": ZERO, "overdue_receivables": ZERO, "overdue_payables": ZERO,
              "open_receivable_items": 0, "open_payable_items": 0,
              "overdue_receivable_items": 0, "overdue_payable_items": 0}
    for t, out_total, overdue_total, open_items, overdue_items in db.execute(sums).all():
        side = "receivable" if t in RECEIVABLE_TYPES else "payable"
        result[f"{side}s"] += to_money(out_total)
        result[f"overdue_{side}s"] += to_money(overdue_total)
        result[f"open_{side}_items"] += open_items
        result[f"overdue_{side}_items"] += overdue_items
    return result


def contact_balances(db: Session, workspace_id: uuid.UUID, kind: str | None = None,
                     contact_ids: list[uuid.UUID] | None = None, today: date | None = None) -> list[dict]:
    """Balance per customer/supplier, derived from their transactions and payments."""
    today = today or today_local()
    contacts_q = select(Contact).where(Contact.workspace_id == workspace_id)
    if kind:
        contacts_q = contacts_q.where(Contact.kind == kind)
    if contact_ids is not None:
        contacts_q = contacts_q.where(Contact.id.in_(contact_ids))
    contacts = db.scalars(contacts_q.order_by(Contact.name)).all()
    if not contacts:
        return []
    ids = [c.id for c in contacts]

    stmt, paid, pending, outstanding = transactions_with_sums(workspace_id)
    agg = stmt.with_only_columns(
        Transaction.contact_id,
        func.sum(Transaction.amount),
        func.sum(paid),
        func.sum(outstanding),
        func.coalesce(func.sum(case((and_(Transaction.due_date < today, outstanding > 0), outstanding),
                                    else_=0)), 0),
        func.min(case((outstanding > 0, Transaction.due_date))),
        func.count(Transaction.id).filter(outstanding > 0),
    ).where(Transaction.contact_id.in_(ids)).group_by(Transaction.contact_id)
    per_contact = {row[0]: row[1:] for row in db.execute(agg).all()}

    advances = dict(db.execute(
        select(Payment.contact_id, func.sum(Payment.amount))
        .where(Payment.workspace_id == workspace_id, Payment.transaction_id.is_(None),
               Payment.status == "completed", Payment.contact_id.in_(ids))
        .group_by(Payment.contact_id)
    ).all())

    result = []
    for c in contacts:
        billed, settled, out, overdue, earliest_due, open_items = per_contact.get(
            c.id, (ZERO, ZERO, ZERO, ZERO, None, 0))
        overdue = to_money(overdue)
        result.append({
            "id": c.id, "kind": c.kind, "name": c.name, "phone": c.phone, "notes": c.notes,
            "is_demo": c.is_demo, "created_at": c.created_at,
            "total_billed": to_money(billed), "total_settled": to_money(settled),
            "outstanding": to_money(out), "overdue_amount": overdue, "is_overdue": overdue > 0,
            "earliest_due_date": earliest_due, "open_items": open_items or 0,
            "advance_balance": to_money(advances.get(c.id)),
        })
    return result


def open_obligations(db: Session, workspace_id: uuid.UUID, contact_id: uuid.UUID) -> list[dict]:
    """A contact's records that still have money due, oldest due first (used for settlement)."""
    stmt, paid, pending, outstanding = transactions_with_sums(workspace_id)
    rows = db.execute(
        stmt.where(Transaction.contact_id == contact_id, outstanding > 0)
        .order_by(func.coalesce(Transaction.due_date, Transaction.transaction_date),
                  Transaction.transaction_date, Transaction.created_at)
    ).all()
    return [{"transaction": t, "paid": to_money(p), "pending": to_money(pe),
             "available": to_money(t.amount) - to_money(p) - to_money(pe)} for t, p, pe in rows]
