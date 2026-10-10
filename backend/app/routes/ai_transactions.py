from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import ai_limiter
from app.core.security import WorkspaceContext, get_workspace_context
from app.database.session import get_db
from app.schemas.ai import ParseTransactionRequest, ParseTransactionResponse
from app.schemas.common import ERROR_RESPONSES
from app.services import ai_transaction_service
from app.services.gemini_service import AIClient, get_ai_client

router = APIRouter(prefix="/ai", tags=["AI transaction entry"], responses=ERROR_RESPONSES)


def ai_rate_limit(ctx: WorkspaceContext = Depends(get_workspace_context),
                  settings: Settings = Depends(get_settings)) -> WorkspaceContext:
    ai_limiter.check(f"ai:{ctx.user_id}", settings.ai_rate_limit_per_minute)
    return ctx


@router.post("/parse-transaction", response_model=ParseTransactionResponse,
             summary="Turn a sentence (English/Urdu/Roman Urdu, typed or voice) into a DRAFT. Never saves.")
def parse_transaction(body: ParseTransactionRequest, ctx: WorkspaceContext = Depends(ai_rate_limit),
                      db: Session = Depends(get_db), ai: AIClient = Depends(get_ai_client)):
    return ai_transaction_service.parse_transaction(db, ctx, ai, body)
