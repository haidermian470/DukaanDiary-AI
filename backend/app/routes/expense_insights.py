from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext
from app.database.session import get_db
from app.routes.ai_transactions import ai_rate_limit
from app.schemas.ai import ExpenseInsightsRequest, ExpenseInsightsResponse
from app.schemas.common import ERROR_RESPONSES
from app.services import expense_insights_service
from app.services.gemini_service import AIClient, get_optional_ai_client
from app.utils.dates import resolve_period

router = APIRouter(prefix="/ai", tags=["AI Expense Insights"], responses=ERROR_RESPONSES)


@router.post("/expense-insights", response_model=ExpenseInsightsResponse,
             summary="Period comparison, top categories, unusual expenses + AI suggestions (read-only)")
def expense_insights(body: ExpenseInsightsRequest, ctx: WorkspaceContext = Depends(ai_rate_limit),
                     db: Session = Depends(get_db), ai: AIClient | None = Depends(get_optional_ai_client)):
    return expense_insights_service.insights(db, ctx, ai, resolve_period(body.period), body.include_purchases)
