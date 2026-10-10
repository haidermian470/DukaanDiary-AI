import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext, get_workspace_context
from app.database.session import get_db
from app.routes.deps import idempotency_key
from app.schemas.common import ERROR_RESPONSES, Page, PaymentStatus
from app.schemas.payment import (
    ContactSettlementCreate, PaymentCreate, PaymentOut, PaymentUpdate, SettlementResult,
)
from app.services import payment_service

router = APIRouter(prefix="/payments", tags=["Payments"], responses=ERROR_RESPONSES)


@router.get("", response_model=Page[PaymentOut])
def list_payments(
    transaction_id: uuid.UUID | None = None, contact_id: uuid.UUID | None = None,
    status: PaymentStatus | None = None, direction: Literal["in", "out"] | None = None,
    date_from: date | None = None, date_to: date | None = None,
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db),
):
    return payment_service.list_payments(db, ctx, transaction_id=transaction_id, contact_id=contact_id,
                                         status=status, direction=direction, date_from=date_from,
                                         date_to=date_to, page=page, page_size=page_size)


@router.post("", response_model=PaymentOut, status_code=status.HTTP_201_CREATED,
             summary="Record a payment against one transaction, or an advance")
def create_payment(body: PaymentCreate, response: Response, key: str | None = Depends(idempotency_key),
                   ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    payment, created = payment_service.create_payment(db, ctx, body, key)
    if not created:
        response.status_code = 200
        response.headers["Idempotent-Replay"] = "true"
    return payment_service.payment_out(db, payment)


@router.post("/settle-contact", response_model=SettlementResult, status_code=status.HTTP_201_CREATED,
             summary="'Ahmed paid 2,000 against his dues' - applied to his oldest dues first")
def settle_contact(body: ContactSettlementCreate, response: Response,
                   key: str | None = Depends(idempotency_key),
                   ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    result = payment_service.settle_contact(db, ctx, body, key)
    if result["replayed"]:
        response.status_code = 200
        response.headers["Idempotent-Replay"] = "true"
    return payment_service.settlement_out(db, result)


@router.get("/{payment_id}", response_model=PaymentOut)
def get_payment(payment_id: uuid.UUID, ctx: WorkspaceContext = Depends(get_workspace_context),
                db: Session = Depends(get_db)):
    return payment_service.payment_out(db, payment_service.get_payment(db, ctx, payment_id))


@router.patch("/{payment_id}", response_model=PaymentOut,
              summary="Change status (pending->completed/failed/cancelled, completed->cancelled) or details")
def update_payment(payment_id: uuid.UUID, body: PaymentUpdate,
                   ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return payment_service.payment_out(db, payment_service.update_payment(db, ctx, payment_id, body))
