from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext, get_workspace_context
from app.database.session import get_db
from app.routes.deps import period_params
from app.schemas.common import ERROR_RESPONSES
from app.schemas.dashboard import DashboardSummary, DashboardTrends, ExpenseBreakdown
from app.services import dashboard_service
from app.utils.dates import Period

router = APIRouter(prefix="/dashboard", tags=["Dashboard"], responses=ERROR_RESPONSES)


@router.get("/summary", response_model=DashboardSummary,
            summary="Cards: sales, expenses, money in/out for the period + receivables/payables today")
def summary(period: Period = Depends(period_params), ctx: WorkspaceContext = Depends(get_workspace_context),
            db: Session = Depends(get_db)):
    return dashboard_service.summary(db, ctx, period)


@router.get("/trends", response_model=DashboardTrends, summary="Chart data per day, week or month")
def trends(period: Period = Depends(period_params),
           granularity: Literal["day", "week", "month"] = Query("day"),
           ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return dashboard_service.trends(db, ctx, period, granularity)


@router.get("/expense-breakdown", response_model=ExpenseBreakdown, summary="Expenses by category")
def expense_breakdown(period: Period = Depends(period_params),
                      include_purchases: bool = Query(False, description="Also include stock purchases"),
                      ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    return dashboard_service.expense_breakdown(db, ctx, period, include_purchases)
