from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.core.security import WorkspaceContext, get_workspace_context
from app.database.session import get_db
from app.routes.ai_transactions import ai_rate_limit
from app.schemas.common import ERROR_RESPONSES
from app.schemas.verification import VerificationHistoryItem, VerificationResult
from app.services import verification_service
from app.services.gemini_service import AIClient, get_ai_client
from app.utils.images import read_image_upload

router = APIRouter(prefix="/ai", tags=["Payment screenshot check (DEMO)"], responses=ERROR_RESPONSES)


@router.post("/analyze-screenshot", response_model=VerificationResult,
             summary="DEMO - NO REAL BANK CONNECTION. Compare a payment screenshot with synthetic Dummy Bank records")
async def analyze_screenshot(file: UploadFile = File(..., description="Payment screenshot (JPEG/PNG/WEBP)"),
                             ctx: WorkspaceContext = Depends(ai_rate_limit), db: Session = Depends(get_db),
                             settings: Settings = Depends(get_settings), ai: AIClient = Depends(get_ai_client)):
    image = await read_image_upload(file, settings.max_upload_bytes)
    return await run_in_threadpool(verification_service.analyze_screenshot, db, ctx, ai, image)


@router.get("/screenshot-checks", response_model=list[VerificationHistoryItem],
            summary="Recent screenshot checks for this shop")
def screenshot_history(limit: int = Query(20, ge=1, le=100), ctx: WorkspaceContext = Depends(get_workspace_context),
                       db: Session = Depends(get_db)):
    return verification_service.history(db, ctx, limit)
