from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.security import WorkspaceContext, require_owner
from app.database.session import get_db
from app.schemas.common import ERROR_RESPONSES
from app.services import demo_service

router = APIRouter(prefix="/demo", tags=["Demo data (fictional)"], responses=ERROR_RESPONSES)


@router.post("/seed", status_code=status.HTTP_201_CREATED,
             summary="Add clearly marked FICTIONAL sample records to this shop (owner only)")
def seed(ctx: WorkspaceContext = Depends(require_owner), db: Session = Depends(get_db)):
    return demo_service.seed(db, ctx)


@router.delete("/data", summary="Remove demo records and Dummy Bank data from this shop (owner only)")
def reset(confirm: bool = Query(False, description="Must be true"),
          ctx: WorkspaceContext = Depends(require_owner), db: Session = Depends(get_db)):
    if not confirm:
        raise AppError("Add ?confirm=true to remove the demo data.", code="confirmation_required")
    return demo_service.reset(db, ctx)
