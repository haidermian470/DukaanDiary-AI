"""Dashboard and report figures. Everything is computed by ledger_service."""
import csv
import io
import uuid
from datetime import date, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext
from app.database.models import Payment, Transaction
from app.services import ledger_service, transaction_service
from app.utils.dates import Period, today_local
from app.utils.money import ZERO, to_money

DEFINITIONS = {
    "total_sales": "Value of all sales dated in the period, whether paid or on credit.",
    "money_received": "Completed payments received in the period. Pending/failed/cancelled are excluded.",
    "net_cash_flow": "Money received minus money paid in the period. It is not cash in hand, "
                     "because the opening cash balance is not recorded.",
    "receivables": "What customers owe you today: sales minus completed payments against them.",
    "payables": "What you owe suppliers today: purchases and expenses minus completed payments.",
    "profit": "Not shown. Profit needs cost-of-goods-sold, which simple sales records do not include.",
}


def summary_figures(db: Session, workspace_id: uuid.UUID, period: Period) -> dict:
    by_type = ledger_service.total_by_type(db, workspace_id, period)
    moved = ledger_service.money_moved(db, workspace_id, period)
    t, c = by_type["totals"], by_type["counts"]
    return {
        "total_sales": t["sale"], "total_purchases": t["purchase"], "total_expenses": t["expense"],
        "money_received": moved["in"], "money_paid": moved["out"],
        "net_cash_flow": moved["in"] - moved["out"],
        "sales_count": c["sale"], "purchases_count": c["purchase"], "expenses_count": c["expense"],
    }


def balances(db: Session, workspace_id: uuid.UUID) -> dict:
    today = today_local()
    return {"as_of": today, **ledger_service.outstanding_totals(db, workspace_id, today)}


def summary(db: Session, ctx: WorkspaceContext, period: Period, recent_limit: int = 5) -> dict:
    recent = transaction_service.list_transactions(db, ctx, page=1, page_size=recent_limit)["items"]
    has_demo = db.scalar(select(func.count()).select_from(Transaction).where(
        Transaction.workspace_id == ctx.workspace_id, Transaction.is_demo.is_(True),
        Transaction.deleted_at.is_(None))) > 0
    return {
        "period": period.as_dict(),
        "figures": summary_figures(db, ctx.workspace_id, period),
        "balances": balances(db, ctx.workspace_id),
        "received_breakdown": ledger_service.money_received_breakdown(db, ctx.workspace_id, period),
        "recent_transactions": recent,
        "has_demo_data": has_demo,
        "definitions": DEFINITIONS,
    }


def _bucket_start(d: date, granularity: str) -> date:
    if granularity == "week":
        return d - timedelta(days=d.weekday())
    if granularity == "month":
        return d.replace(day=1)
    return d


def _next_bucket(d: date, granularity: str) -> date:
    if granularity == "week":
        return d + timedelta(days=7)
    if granularity == "month":
        return (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return d + timedelta(days=1)


def trends(db: Session, ctx: WorkspaceContext, period: Period, granularity: str) -> dict:
    """Per day/week/month totals. Buckets with no activity are included as zeros."""
    if period.name == "all_time":
        first = db.scalar(select(func.min(Transaction.transaction_date)).where(
            ledger_service.active_transaction_filter(ctx.workspace_id)))
        period = Period("all_time", first or period.end, period.end)

    buckets: dict[date, dict] = {}
    cursor = _bucket_start(period.start, granularity)
    while cursor <= period.end and len(buckets) < 400:
        buckets[cursor] = {"bucket_start": cursor,
                           "bucket_end": min(_next_bucket(cursor, granularity) - timedelta(days=1), period.end),
                           "sales": ZERO, "purchases": ZERO, "expenses": ZERO,
                           "money_received": ZERO, "money_paid": ZERO}
        cursor = _next_bucket(cursor, granularity)

    txn_rows = db.execute(
        select(Transaction.transaction_date, Transaction.type, func.sum(Transaction.amount))
        .where(ledger_service.active_transaction_filter(ctx.workspace_id),
               Transaction.transaction_date.between(period.start, period.end))
        .group_by(Transaction.transaction_date, Transaction.type)).all()
    key_for = {"sale": "sales", "purchase": "purchases", "expense": "expenses"}
    for d, t, total in txn_rows:
        b = buckets.get(_bucket_start(d, granularity))
        if b:
            b[key_for[t]] += to_money(total)

    pay_rows = db.execute(
        select(Payment.payment_date, Payment.direction, func.sum(Payment.amount))
        .outerjoin(Transaction, Transaction.id == Payment.transaction_id)
        .where(Payment.workspace_id == ctx.workspace_id, Payment.status == "completed",
               or_(Payment.transaction_id.is_(None), Transaction.deleted_at.is_(None)),
               Payment.payment_date.between(period.start, period.end))
        .group_by(Payment.payment_date, Payment.direction)).all()
    for d, direction, total in pay_rows:
        b = buckets.get(_bucket_start(d, granularity))
        if b:
            b["money_received" if direction == "in" else "money_paid"] += to_money(total)

    return {"period": period.as_dict(), "granularity": granularity, "points": list(buckets.values())}


def expense_breakdown(db: Session, ctx: WorkspaceContext, period: Period, include_purchases: bool) -> dict:
    types = ("expense", "purchase") if include_purchases else ("expense",)
    cats = ledger_service.expense_by_category(db, ctx.workspace_id, period, types)
    return {"period": period.as_dict(), "include_purchases": include_purchases,
            "total": sum((c["total"] for c in cats), ZERO), "categories": cats}


def report_summary(db: Session, ctx: WorkspaceContext, period: Period) -> dict:
    owing = [b for b in ledger_service.contact_balances(db, ctx.workspace_id, "customer") if b["outstanding"] > 0]
    owed = [b for b in ledger_service.contact_balances(db, ctx.workspace_id, "supplier") if b["outstanding"] > 0]
    slim = lambda b: {"id": str(b["id"]), "name": b["name"], "outstanding": b["outstanding"],
                      "overdue_amount": b["overdue_amount"], "earliest_due_date": b["earliest_due_date"]}
    return {
        "period": period.as_dict(),
        "figures": summary_figures(db, ctx.workspace_id, period),
        "balances": balances(db, ctx.workspace_id),
        "expense_categories": ledger_service.expense_by_category(db, ctx.workspace_id, period),
        "top_customers_owing": [slim(b) for b in sorted(owing, key=lambda b: -b["outstanding"])[:10]],
        "top_suppliers_owed": [slim(b) for b in sorted(owed, key=lambda b: -b["outstanding"])[:10]],
        "limitations": [DEFINITIONS["net_cash_flow"], DEFINITIONS["profit"]],
    }


CSV_COLUMNS = ["transaction_date", "type", "category", "description", "contact", "amount",
               "amount_paid", "outstanding", "settlement_status", "due_date", "is_overdue", "source", "id"]


def transactions_csv(items: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for t in items:
        row = {**t, "contact": t["contact"]["name"] if t["contact"] else ""}
        # Prevent spreadsheet formula injection from user-entered text.
        values = (row.get(c) if row.get(c) is not None else "" for c in CSV_COLUMNS)
        writer.writerow([("'" + v) if isinstance(v, str) and v and v[0] in "=+-@" else v for v in values])
    return buffer.getvalue()
