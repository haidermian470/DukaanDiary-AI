from fastapi import APIRouter, Depends, File, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.core.security import WorkspaceContext
from app.routes.ai_transactions import ai_rate_limit
from app.schemas.common import ERROR_RESPONSES
from app.schemas.verification import ReceiptAnalysis
from app.services import receipt_service
from app.services.gemini_service import AIClient, get_ai_client
from app.utils.images import read_image_upload

router = APIRouter(prefix="/ai", tags=["Receipt analysis"], responses=ERROR_RESPONSES)


@router.post("/analyze-receipt", response_model=ReceiptAnalysis,
             summary="Read a receipt/bill image (JPEG/PNG/WEBP) into a DRAFT. Image is not stored.")
async def analyze_receipt(file: UploadFile = File(..., description="Receipt image"),
                          ctx: WorkspaceContext = Depends(ai_rate_limit),
                          settings: Settings = Depends(get_settings), ai: AIClient = Depends(get_ai_client)):
    image = await read_image_upload(file, settings.max_upload_bytes)
    return await run_in_threadpool(receipt_service.analyze_receipt, ai, image)
