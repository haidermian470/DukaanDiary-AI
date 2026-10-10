import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext, get_workspace_context
from app.database.session import get_db
from app.schemas.common import ERROR_RESPONSES, ContactKind
from app.schemas.contact import ContactBalance, ContactCreate, ContactLedger, ContactOut, ContactUpdate
from app.services import contact_service, ledger_service

router = APIRouter(prefix="/contacts", tags=["Customers & suppliers"], responses=ERROR_RESPONSES)


@router.get("", response_model=list[ContactBalance],
            summary="List customers or suppliers with their balances (ledger overview)")
def list_contacts(
    kind: ContactKind | None = Query(None),
    with_balance_only: bool = Query(False, description="Only contacts with money outstanding"),
    overdue_only: bool = Query(False),
    ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db),
):
    items = ledger_service.contact_balances(db, ctx.workspace_id, kind)
    if with_balance_only:
        items = [i for i in items if i["outstanding"] > 0]
    if overdue_only:
        items = [i for i in items if i["is_overdue"]]
    return items


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(body: ContactCreate, ctx: WorkspaceContext = Depends(get_workspace_context),
                   db: Session = Depends(get_db)):
    return contact_service.create_contact(db, ctx, body)


@router.get("/{contact_id}", response_model=ContactLedger,
            summary="One customer/supplier with balance and full ledger (running balance)")
def get_contact_ledger(contact_id: uuid.UUID, ctx: WorkspaceContext = Depends(get_workspace_context),
                       db: Session = Depends(get_db)):
    return contact_service.ledger(db, ctx, contact_id)


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: uuid.UUID, body: ContactUpdate,
                   ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return contact_service.update_contact(db, ctx, contact_id, body)
