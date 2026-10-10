import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext, get_workspace_context
from app.database.session import get_db
from app.routes.deps import period_params
from app.schemas.common import ERROR_RESPONSES, Page, SettlementStatus, TransactionType
from app.schemas.dashboard import ReportSummary
from app.schemas.transaction import TransactionOut
from app.services import dashboard_service, transaction_service
from app.utils.dates import Period

router = APIRouter(prefix="/reports", tags=["Reports"], responses=ERROR_RESPONSES)


@router.get("/summary", response_model=ReportSummary, summary="Period report with balances and top dues")
def report_summary(period: Period = Depends(period_params),
                   ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return dashboard_service.report_summary(db, ctx, period)


@router.get("/transactions", response_model=Page[TransactionOut],
            summary="Filtered transaction report. Add format=csv to download a spreadsheet.")
def report_transactions(
    period: Period = Depends(period_params),
    type: TransactionType | None = None,
    category: str | None = Query(None, max_length=60),
    settlement_status: SettlementStatus | None = None,
    contact_id: uuid.UUID | None = None,
    format: Literal["json", "csv"] = "json",
    page: int = Query(1, ge=1), page_size: int = Query(100, ge=1, le=100),
    ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db),
):
    filters = dict(type=type, category=category, settlement_status=settlement_status, contact_id=contact_id,
                   date_from=period.start, date_to=period.end)
    if format == "csv":
        items, page_no = [], 1
        while True:  # export every matching row, 100 at a time (capped at 10,000)
            chunk = transaction_service.list_transactions(db, ctx, page=page_no, page_size=100, **filters)
            items.extend(chunk["items"])
            if not chunk["has_more"] or len(items) >= 10_000:
                break
            page_no += 1
        filename = f"dukaandiary_{period.start}_{period.end}.csv"
        return Response(content=dashboard_service.transactions_csv(items), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    return transaction_service.list_transactions(db, ctx, page=page, page_size=page_size, **filters)
