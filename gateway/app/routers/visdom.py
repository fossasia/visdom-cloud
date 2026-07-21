
"""
Internal resolve endpoint used by the visdom server's workspace manager to map a
programmatic API key plus workspace slug to a workspace id and the caller's role.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.dependencies import enforce_api_key_workspace_scope, get_api_key, get_db
from app.models import APIKey, Membership, Workspace

router = APIRouter(prefix="/visdom", tags=["visdom"])


class VisdomResolveRequest(BaseModel):
    workspace_slug: str


class VisdomResolveResponse(BaseModel):
    workspace_id: str
    role: str
    allowed: bool


@router.post("/resolve", response_model=VisdomResolveResponse)
def resolve_workspace(
    payload: VisdomResolveRequest,
    key_record: APIKey = Depends(get_api_key),
    db: Session = Depends(get_db),
):
    """
    Resolves an API key and workspace slug to that workspace's id and the key
    owner's role. Validates the key's workspace-scope binding and active
    membership, reusing the same enforcement as the rest of the API. Returns the
    role so the caller can map viewer to read-only.
    """
    workspace = (
        db.query(Workspace).filter(Workspace.slug == payload.workspace_slug).first()
    )
    if not workspace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found."
        )

    enforce_api_key_workspace_scope(db, key_record, workspace.id)

    membership = (
        db.query(Membership)
        .filter(
            Membership.workspace_id == workspace.id,
            Membership.user_id == key_record.user_id,
            Membership.status == "active",
        )
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This API key's owner is not an active member of this workspace.",
        )

    return VisdomResolveResponse(
        workspace_id=str(workspace.id),
        role=membership.role,
        allowed=True,
    )
