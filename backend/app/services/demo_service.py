"""Clearly labelled FICTIONAL demo data, so the dashboard and assistant have something to show.

Every row created here has is_demo=true (and source='demo_seed'), and the API returns that flag,
so the UI can show a "Demo data" badge. Dates are relative to today so the demo always looks current.
"""
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError
from app.core.security import WorkspaceContext
from app.database.models import (
    Contact, DummyBankAccount, DummyBankImport, DummyBankTransaction, Payment, PaymentVerification, Transaction,
)
from app.schemas.transaction import TransactionCreate
from app.services import contact_service, dummy_bank_service, transaction_service
from app.utils.dates import today_local

# (days_ago, type, amount, paid, method, description, category, contact, due_in_days)
DEMO_TRANSACTIONS = [
    (40, "expense", "600", "600", "cash", "Rickshaw for stock pickup", "transport", None, None),
    (35, "expense", "2400", "2400", "bank", "Electricity bill (last month)", "electricity", "K-Electric", None),
    (30, "expense", "650", "650", "cash", "Loader van to market", "transport", None, None),
    (20, "expense", "700", "700", "cash", "Delivery charges", "transport", None, None),
    (12, "sale", "5000", "3000", "cash", "Groceries sold on partial credit", "sales", "Ahmed Raza", -5),
    (10, "sale", "2500", "2500", "cash", "Walk-in counter sales", "sales", None, None),
    (9, "purchase", "10000", "4000", "cash", "Rice and flour stock", "stock", "Karachi Wholesale Mart", 5),
    (6, "sale", "7000", "0", None, "Bulk order on credit", "sales", "Bilal Traders", 7),
    (4, "expense", "800", "800", "cash", "Transport to wholesale market", "transport", None, None),
    (3, "expense", "2750", "2750", "bank", "Electricity bill", "electricity", "K-Electric", None),
    (2, "sale", "3200", "1200", "mobile_wallet", "Monthly ration order", "sales", "Sana Ahmed", 1),
    (1, "expense", "2200", "2200", "cash", "Truck hire for large delivery", "transport", None, None),
]
DEMO_PHONES = {"Ahmed Raza": "03001234567", "Sana Ahmed": "03211234567", "Bilal Traders": "03331234567"}


def has_demo_data(db: Session, ctx: WorkspaceContext) -> bool:
    return db.scalar(select(func.count()).select_from(Transaction).where(
        Transaction.workspace_id == ctx.workspace_id, Transaction.is_demo.is_(True))) > 0


def seed(db: Session, ctx: WorkspaceContext) -> dict:
    if has_demo_data(db, ctx):
        raise ConflictError("Demo data already exists. Reset it first if you want fresh demo data.")
    today = today_local()
    for name, phone in DEMO_PHONES.items():
        contact_service.find_or_create(db, ctx, "customer", name, phone, is_demo=True)

    created = []
    for days_ago, ttype, amount, paid, method, desc, cat, contact, due_in in DEMO_TRANSACTIONS:
        tdate = today - timedelta(days=days_ago)
        due = today + timedelta(days=due_in) if due_in is not None else None
        if due is not None and due < tdate:
            due = tdate
        txn, _ = transaction_service.create_transaction(
            db, ctx, TransactionCreate(type=ttype, amount=Decimal(amount), amount_paid=Decimal(paid),
                                       payment_method=method, description=f"[DEMO] {desc}", category=cat,
                                       transaction_date=tdate, due_date=due, contact_name=contact),
            source="demo_seed", is_demo=True, commit=False)
        created.append(txn)

    # Bilal Traders paid 2,000 of his credit yesterday (a settlement, not a new sale).
    bilal_sale = next(t for t in created if t.description.endswith("Bulk order on credit"))
    db.add(Payment(workspace_id=ctx.workspace_id, transaction_id=bilal_sale.id, contact_id=bilal_sale.contact_id,
                   direction="in", amount=Decimal("2000"), payment_date=today - timedelta(days=1), method="cash",
                   status="completed", notes="[DEMO] Part payment against dues", is_demo=True,
                   created_by=ctx.user_id))
    db.commit()
    dummy_bank_service.ensure_seeded(db, ctx)
    return {"created_transactions": len(created), "message": "Fictional demo data added. All rows are marked is_demo."}


def reset(db: Session, ctx: WorkspaceContext) -> dict:
    """Remove demo rows and ALL Dummy Bank data for this shop (owner only). Real records are untouched,
    except payments that came from Dummy Bank imports (those are demo money by definition)."""
    ws = ctx.workspace_id
    import_ids = select(DummyBankImport.id).where(DummyBankImport.workspace_id == ws)
    bank_txn_ids = list(db.scalars(select(Transaction.id).where(Transaction.workspace_id == ws,
                                                                Transaction.source == "dummy_bank")))
    demo_txn_ids = list(db.scalars(select(Transaction.id).where(Transaction.workspace_id == ws,
                                                                Transaction.is_demo.is_(True))))
    removed_payments = db.execute(delete(Payment).where(
        Payment.workspace_id == ws,
        or_(Payment.is_demo.is_(True), Payment.dummy_bank_import_id.in_(import_ids),
            Payment.transaction_id.in_(bank_txn_ids + demo_txn_ids)))).rowcount
    db.execute(update(DummyBankImport).where(DummyBankImport.workspace_id == ws)
               .values(created_transaction_id=None))
    db.execute(delete(DummyBankImport).where(DummyBankImport.workspace_id == ws))
    removed_txns = db.execute(delete(Transaction).where(Transaction.id.in_(bank_txn_ids + demo_txn_ids))).rowcount
    db.execute(delete(PaymentVerification).where(PaymentVerification.workspace_id == ws))
    db.execute(delete(DummyBankTransaction).where(DummyBankTransaction.workspace_id == ws))
    db.execute(delete(DummyBankAccount).where(DummyBankAccount.workspace_id == ws))
    # Demo contacts that no real record uses any more.
    removed_contacts = db.execute(delete(Contact).where(
        Contact.workspace_id == ws, Contact.is_demo.is_(True),
        ~exists().where(Transaction.contact_id == Contact.id),
        ~exists().where(Payment.contact_id == Contact.id))).rowcount
    db.commit()
    return {"removed_transactions": removed_txns, "removed_payments": removed_payments,
            "removed_contacts": removed_contacts,
            "message": "Demo data and Dummy Bank data removed. Your own records were kept."}
