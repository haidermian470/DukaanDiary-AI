import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext, get_workspace_context
from app.database.session import get_db
from app.schemas.common import ERROR_RESPONSES, PaymentStatus
from app.schemas.dummy_bank import (
    DummyBankAccountOut, DummyBankImportRequest, DummyBankImportResult, DummyBankTransactionOut,
    SimulateIncomingRequest, SimulateStatusRequest,
)
from app.services import dummy_bank_service

router = APIRouter(prefix="/dummy-bank", tags=["Dummy Bank (DEMO - synthetic data)"], responses=ERROR_RESPONSES)


@router.get("/accounts", response_model=list[DummyBankAccountOut],
            summary="Synthetic demo account (created automatically on first use)")
def accounts(ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return dummy_bank_service.list_accounts(db, ctx)


@router.get("/transactions", response_model=list[DummyBankTransactionOut])
def transactions(status: PaymentStatus | None = None, direction: Literal["in", "out"] | None = None,
                 not_imported_only: bool = Query(False),
                 ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return dummy_bank_service.list_transactions(db, ctx, status, direction, not_imported_only)


@router.get("/transactions/{bank_txn_id}", response_model=DummyBankTransactionOut)
def transaction(bank_txn_id: uuid.UUID, ctx: WorkspaceContext = Depends(get_workspace_context),
                db: Session = Depends(get_db)):
    return dummy_bank_service.get_transaction_out(db, ctx, bank_txn_id)


@router.post("/import/{bank_txn_id}", response_model=DummyBankImportResult, status_code=status.HTTP_201_CREATED,
             summary="Record a COMPLETED demo transfer in the books (once only, no double counting)")
def import_transaction(bank_txn_id: uuid.UUID, body: DummyBankImportRequest,
                       ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return dummy_bank_service.import_transaction(db, ctx, bank_txn_id, body)


@router.post("/simulate/incoming", response_model=DummyBankTransactionOut, status_code=status.HTTP_201_CREATED,
             summary="Demo control: a synthetic transfer arrives (e.g. the 'delayed transfer' demo)")
def simulate_incoming(body: SimulateIncomingRequest, ctx: WorkspaceContext = Depends(get_workspace_context),
                      db: Session = Depends(get_db)):
    return dummy_bank_service.simulate_incoming(db, ctx, body)


@router.post("/simulate/transactions/{bank_txn_id}/status", response_model=DummyBankTransactionOut,
             summary="Demo control: a pending synthetic transfer completes, fails or is cancelled")
def simulate_status(bank_txn_id: uuid.UUID, body: SimulateStatusRequest,
                    ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return dummy_bank_service.simulate_status(db, ctx, bank_txn_id, body.status)
