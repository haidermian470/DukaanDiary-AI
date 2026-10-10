from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext
from app.database.session import get_db
from app.routes.ai_transactions import ai_rate_limit
from app.schemas.ai import AssistantRequest, AssistantResponse
from app.schemas.common import ERROR_RESPONSES
from app.services import assistant_service
from app.services.gemini_service import AIClient, get_optional_ai_client

router = APIRouter(prefix="/ai", tags=["AI Financial Assistant"], responses=ERROR_RESPONSES)


@router.post("/assistant", response_model=AssistantResponse,
             summary="Ask about your own records. Figures come from the backend; AI only explains them.")
def ask(body: AssistantRequest, ctx: WorkspaceContext = Depends(ai_rate_limit), db: Session = Depends(get_db),
        ai: AIClient | None = Depends(get_optional_ai_client)):
    return assistant_service.answer_question(db, ctx, ai, body.question.strip())
