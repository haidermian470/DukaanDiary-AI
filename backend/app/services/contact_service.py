"""Customers and suppliers."""
import uuid
from difflib import SequenceMatcher

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.core.security import WorkspaceContext
from app.database.models import Contact, Payment, Transaction
from app.schemas.contact import ContactCreate, ContactUpdate
from app.services import ledger_service
from app.utils.money import to_money


def normalise_name(name: str) -> str:
    return " ".join(name.split())


def get_contact(db: Session, ctx: WorkspaceContext, contact_id: uuid.UUID) -> Contact:
    contact = db.scalar(select(Contact).where(Contact.id == contact_id,
                                              Contact.workspace_id == ctx.workspace_id))
    if contact is None:
        raise NotFoundError("Customer or supplier not found.")
    return contact


def find_by_name(db: Session, workspace_id: uuid.UUID, name: str, kind: str | None = None) -> list[Contact]:
    """Exact (case-insensitive) name matches."""
    q = select(Contact).where(Contact.workspace_id == workspace_id,
                              func.lower(func.btrim(Contact.name)) == normalise_name(name).lower())
    if kind:
        q = q.where(Contact.kind == kind)
    return list(db.scalars(q))


def search_similar(db: Session, workspace_id: uuid.UUID, name: str, kind: str | None = None,
                   limit: int = 5) -> list[Contact]:
    """Suggestions for a name that has no exact match.

    Catches partial names ("ahmed" -> "Ahmed Khan") and spelling variants that are
    common in Roman Urdu ("Ahmad" -> "Ahmed", "Bilaal" -> "Bilal").
    """
    wanted = normalise_name(name).lower()
    if not wanted:
        return []
    q = select(Contact).where(Contact.workspace_id == workspace_id)
    if kind:
        q = q.where(Contact.kind == kind)
    scored = []
    for contact in db.scalars(q.order_by(Contact.name).limit(1000)):
        candidate = contact.name.lower()
        words = candidate.split(" ")
        if wanted in candidate or candidate.startswith(wanted.split(" ")[0]):
            score = 1.0
        else:
            score = max([SequenceMatcher(None, wanted, candidate).ratio()] +
                        [SequenceMatcher(None, wanted, w).ratio() for w in words])
        if score >= 0.75:
            scored.append((score, contact.name, contact))
    scored.sort(key=lambda s: (-s[0], s[1]))
    return [c for _, _, c in scored[:limit]]


def find_or_create(db: Session, ctx: WorkspaceContext, kind: str, name: str,
                   phone: str | None = None, is_demo: bool = False) -> Contact:
    clean = normalise_name(name)
    if not clean:
        raise BusinessRuleError("The customer/supplier name cannot be empty.")
    existing = find_by_name(db, ctx.workspace_id, clean, kind)
    if existing:
        contact = existing[0]
        if phone and not contact.phone:
            contact.phone = phone
        return contact
    contact = Contact(workspace_id=ctx.workspace_id, kind=kind, name=clean, phone=phone, is_demo=is_demo)
    try:
        with db.begin_nested():  # savepoint: a parallel request may have just created the same name
            db.add(contact)
            db.flush()
    except IntegrityError:
        return find_by_name(db, ctx.workspace_id, clean, kind)[0]
    return contact


def create_contact(db: Session, ctx: WorkspaceContext, data: ContactCreate) -> Contact:
    clean = normalise_name(data.name)
    if find_by_name(db, ctx.workspace_id, clean, data.kind):
        raise ConflictError(f"A {data.kind} named '{clean}' already exists.")
    contact = Contact(workspace_id=ctx.workspace_id, kind=data.kind, name=clean,
                      phone=data.phone, notes=data.notes)
    db.add(contact)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(f"A {data.kind} named '{clean}' already exists.")
    return contact


def update_contact(db: Session, ctx: WorkspaceContext, contact_id: uuid.UUID, data: ContactUpdate) -> Contact:
    contact = get_contact(db, ctx, contact_id)
    fields = data.model_fields_set
    if "name" in fields and data.name:
        clean = normalise_name(data.name)
        clash = [c for c in find_by_name(db, ctx.workspace_id, clean, contact.kind) if c.id != contact.id]
        if clash:
            raise ConflictError(f"A {contact.kind} named '{clean}' already exists.")
        contact.name = clean
    if "phone" in fields:
        contact.phone = data.phone
    if "notes" in fields:
        contact.notes = data.notes
    db.commit()
    return contact


def balance(db: Session, ctx: WorkspaceContext, contact_id: uuid.UUID) -> dict:
    get_contact(db, ctx, contact_id)
    return ledger_service.contact_balances(db, ctx.workspace_id, contact_ids=[contact_id])[0]


def ledger(db: Session, ctx: WorkspaceContext, contact_id: uuid.UUID) -> dict:
    """Chronological statement for one customer/supplier with a running balance."""
    contact = get_contact(db, ctx, contact_id)
    txns = db.scalars(select(Transaction).where(
        ledger_service.active_transaction_filter(ctx.workspace_id),
        Transaction.contact_id == contact.id)).all()
    payments = db.scalars(
        select(Payment).outerjoin(Transaction, Transaction.id == Payment.transaction_id)
        .where(Payment.workspace_id == ctx.workspace_id, Payment.contact_id == contact.id,
               or_(Payment.transaction_id.is_(None), Transaction.deleted_at.is_(None)))).all()

    events = []
    for t in txns:
        events.append((t.transaction_date, t.created_at, 0, {
            "date": t.transaction_date, "entry_type": t.type, "description": t.description,
            "amount": to_money(t.amount), "effect": to_money(t.amount), "status": None,
            "transaction_id": t.id, "payment_id": None}))
    for p in payments:
        counted = p.status == "completed"
        events.append((p.payment_date, p.created_at, 1, {
            "date": p.payment_date, "entry_type": "advance" if p.transaction_id is None else "payment",
            "description": (p.notes or ("Advance" if p.transaction_id is None else "Payment"))
                           + f" ({p.method}, {p.status})",
            "amount": to_money(p.amount), "effect": -to_money(p.amount) if counted else to_money(0),
            "status": p.status, "transaction_id": p.transaction_id, "payment_id": p.id}))
    events.sort(key=lambda e: (e[0], e[2], e[1]))

    running = to_money(0)
    entries = []
    for *_, entry in events:
        running += entry["effect"]
        entries.append({**entry, "running_balance": running})
    return {"contact": balance(db, ctx, contact.id), "entries": entries}
