import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext, get_workspace_context
from app.database.session import get_db
from app.routes.deps import idempotency_key
from app.schemas.common import ERROR_RESPONSES, Page, SettlementStatus, TransactionType
from app.schemas.transaction import TransactionCreate, TransactionDetail, TransactionOut, TransactionUpdate
from app.services import transaction_service

router = APIRouter(prefix="/transactions", tags=["Transactions"], responses=ERROR_RESPONSES)


@router.get("", response_model=Page[TransactionOut], summary="List transactions (newest first)")
def list_transactions(
    type: TransactionType | None = None,
    category: str | None = Query(None, max_length=60),
    settlement_status: SettlementStatus | None = None,
    contact_id: uuid.UUID | None = None,
    contact_name: str | None = Query(None, max_length=120, description="Partial name match"),
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = Query(None, max_length=100, description="Search description/category"),
    overdue_only: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    ctx: WorkspaceContext = Depends(get_workspace_context),
    db: Session = Depends(get_db),
):
    return transaction_service.list_transactions(
        db, ctx, type=type, category=category, settlement_status=settlement_status,
        contact_id=contact_id, contact_name=contact_name, date_from=date_from, date_to=date_to,
        search=search, overdue_only=overdue_only, page=page, page_size=page_size)


@router.post("", response_model=TransactionDetail, status_code=status.HTTP_201_CREATED,
             summary="Save a confirmed sale, purchase or expense (with any amount paid now)")
def create_transaction(body: TransactionCreate, response: Response,
                       key: str | None = Depends(idempotency_key),
                       ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    txn, created = transaction_service.create_transaction(db, ctx, body, key)
    if not created:
        response.status_code = status.HTTP_200_OK
        response.headers["Idempotent-Replay"] = "true"
    return transaction_service.transaction_detail(db, ctx, txn.id)


@router.get("/{transaction_id}", response_model=TransactionDetail)
def get_transaction(transaction_id: uuid.UUID, ctx: WorkspaceContext = Depends(get_workspace_context),
                    db: Session = Depends(get_db)):
    return transaction_service.transaction_detail(db, ctx, transaction_id)


@router.patch("/{transaction_id}", response_model=TransactionDetail)
def update_transaction(transaction_id: uuid.UUID, body: TransactionUpdate,
                       ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    transaction_service.update_transaction(db, ctx, transaction_id, body)
    return transaction_service.transaction_detail(db, ctx, transaction_id)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Void a mistaken record (it and its payments leave every total)")
def delete_transaction(transaction_id: uuid.UUID, ctx: WorkspaceContext = Depends(get_workspace_context),
                       db: Session = Depends(get_db)):
    transaction_service.void_transaction(db, ctx, transaction_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
