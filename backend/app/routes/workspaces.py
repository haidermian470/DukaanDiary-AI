from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import WorkspaceContext, get_workspace_context, require_owner
from app.database.models import Workspace, WorkspaceMember
from app.database.session import get_db
from app.schemas.common import ERROR_RESPONSES

router = APIRouter(tags=["Account & workspace"], responses=ERROR_RESPONSES)


class WorkspaceRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def _workspace_out(ws: Workspace, role: str) -> dict:
    return {"id": str(ws.id), "name": ws.name, "currency": ws.currency.strip(),
            "timezone": ws.timezone, "role": role}


@router.get("/me", summary="Current user and their shops (creates a default shop on first call)")
def me(ctx: WorkspaceContext = Depends(get_workspace_context), db: Session = Depends(get_db)):
    rows = db.execute(select(Workspace, WorkspaceMember.role)
                      .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
                      .where(WorkspaceMember.user_id == ctx.user_id)
                      .order_by(WorkspaceMember.created_at)).all()
    return {"user": {"id": str(ctx.user_id), "email": ctx.user.email},
            "current_workspace_id": str(ctx.workspace_id),
            "workspaces": [_workspace_out(ws, role) for ws, role in rows]}


@router.patch("/workspaces/current", summary="Rename the current shop (owner only)")
def rename_workspace(body: WorkspaceRename, ctx: WorkspaceContext = Depends(require_owner),
                     db: Session = Depends(get_db)):
    ws = db.get(Workspace, ctx.workspace_id)
    ws.name = body.name.strip()
    db.commit()
    return _workspace_out(ws, ctx.role)
