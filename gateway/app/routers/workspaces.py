# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Workspace router handling workspace CRUD, team memberships/roles, and
public shared-link tokens.
"""

import datetime
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.models import Membership, SharedLink, User, Workspace, utcnow
from app.schemas.workspace import (
    MemberInvite,
    MemberResponse,
    MemberRoleUpdate,
    MyWorkspaceResponse,
    SharedLinkCreate,
    SharedLinkJoinRequest,
    SharedLinkJoinResponse,
    SharedLinkResponse,
    StarredUpdate,
    WorkspaceCreate,
)
from app.security import get_password_hash, verify_password

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _get_membership(db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Membership | None:
    return (
        db.query(Membership)
        .filter(Membership.workspace_id == workspace_id, Membership.user_id == user_id)
        .first()
    )


def _require_member(db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Membership:
    """Ensures the user belongs to the workspace, else 404 (hides existence from non-members)."""
    membership = _get_membership(db, workspace_id, user_id)
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found.")
    return membership


def _require_admin(db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> Membership:
    membership = _require_member(db, workspace_id, user_id)
    if membership.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only workspace admins can perform this action.",
        )
    return membership


def _to_member_response(membership: Membership) -> MemberResponse:
    return MemberResponse(user_id=membership.user_id, email=membership.user.email, role=membership.role)


def _to_my_workspace_response(workspace: Workspace, membership: Membership) -> MyWorkspaceResponse:
    return MyWorkspaceResponse(
        id=workspace.id,
        name=workspace.name,
        slug=workspace.slug,
        created_by=workspace.created_by,
        role=membership.role,
        starred=bool(membership.starred),
    )


def _to_shared_link_response(link: SharedLink) -> SharedLinkResponse:
    return SharedLinkResponse(
        id=link.id,
        workspace_id=link.workspace_id,
        role=link.role,
        expires_at=link.expires_at,
        has_password=bool(link.password_hash),
    )


# --- WORKSPACES ---
@router.post("", response_model=MyWorkspaceResponse, status_code=status.HTTP_201_CREATED)
def create_workspace(
    workspace_in: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Creates a workspace and grants the creator an admin membership."""
    existing = db.query(Workspace).filter(Workspace.slug == workspace_in.slug).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A workspace with this slug already exists.",
        )

    workspace = Workspace(name=workspace_in.name, slug=workspace_in.slug, created_by=current_user.id)
    db.add(workspace)
    db.flush()  # populate workspace.id before creating the membership row

    membership = Membership(user_id=current_user.id, workspace_id=workspace.id, role="admin")
    db.add(membership)
    db.commit()
    db.refresh(workspace)
    db.refresh(membership)
    return _to_my_workspace_response(workspace, membership)


@router.get("", response_model=List[MyWorkspaceResponse])
def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists all workspaces the current user belongs to, with their role and starred flag."""
    rows = (
        db.query(Workspace, Membership)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .filter(Membership.user_id == current_user.id)
        .all()
    )
    return [_to_my_workspace_response(ws, membership) for ws, membership in rows]


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Deletes a workspace and its memberships/shared links. Admins only."""
    _require_admin(db, workspace_id, current_user.id)
    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    db.delete(workspace)
    db.commit()


@router.patch("/{workspace_id}/star", response_model=MyWorkspaceResponse)
def set_workspace_starred(
    workspace_id: uuid.UUID,
    payload: StarredUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stars/unstars a workspace for the current user. A personal preference, not admin-gated."""
    membership = _require_member(db, workspace_id, current_user.id)
    membership.starred = payload.starred
    db.commit()
    db.refresh(membership)

    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    return _to_my_workspace_response(workspace, membership)


# --- MEMBERSHIPS ---
@router.post("/{workspace_id}/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
def invite_member(
    workspace_id: uuid.UUID,
    invite: MemberInvite,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Adds a collaborator to the workspace by looking up their account by email. Admins only."""
    _require_admin(db, workspace_id, current_user.id)

    invitee = db.query(User).filter(User.email.ilike(invite.email)).first()
    if not invitee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No user found with this email address.",
        )

    if _get_membership(db, workspace_id, invitee.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of this workspace.",
        )

    membership = Membership(user_id=invitee.id, workspace_id=workspace_id, role=invite.role)
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return _to_member_response(membership)


@router.get("/{workspace_id}/members", response_model=List[MemberResponse])
def list_members(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists all members and roles for the workspace."""
    _require_member(db, workspace_id, current_user.id)
    memberships = db.query(Membership).filter(Membership.workspace_id == workspace_id).all()
    return [_to_member_response(m) for m in memberships]


@router.put("/{workspace_id}/members/{user_id}", response_model=MemberResponse)
def update_member_role(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role_update: MemberRoleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Updates a collaborator's role. Admins only, and only for other members —
    no one can change their own role, and the workspace owner's role can only
    ever be set by no one at all (it's fixed once the workspace is created).
    """
    _require_admin(db, workspace_id, current_user.id)

    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot change your own role.",
        )

    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if workspace.created_by == user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The workspace owner's role cannot be changed.",
        )

    membership = _get_membership(db, workspace_id, user_id)
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found in this workspace.")

    membership.role = role_update.role
    db.commit()
    db.refresh(membership)
    return _to_member_response(membership)


@router.delete("/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Removes a member from the workspace. Admins can remove non-owner members; members may
    remove (leave) themselves. The workspace owner (its creator) can only be removed by
    themselves — no other admin can kick the owner out.
    """
    requester_membership = _require_member(db, workspace_id, current_user.id)

    is_self_leave = current_user.id == user_id
    if requester_membership.role != "admin" and not is_self_leave:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only workspace admins can remove other members.",
        )

    workspace = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if workspace.created_by == user_id and not is_self_leave:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can remove themselves from the workspace.",
        )

    membership = _get_membership(db, workspace_id, user_id)
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found in this workspace.")

    if membership.role == "admin":
        other_admins = (
            db.query(Membership)
            .filter(
                Membership.workspace_id == workspace_id,
                Membership.role == "admin",
                Membership.user_id != user_id,
            )
            .count()
        )
        if other_admins == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the last admin of a workspace.",
            )

    db.delete(membership)
    db.commit()


# --- SHARED LINKS ---
@router.post("/{workspace_id}/share", response_model=SharedLinkResponse, status_code=status.HTTP_201_CREATED)
def create_shared_link(
    workspace_id: uuid.UUID,
    link_in: SharedLinkCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generates a secure public share token for the workspace. Admins only."""
    _require_admin(db, workspace_id, current_user.id)

    link = SharedLink(
        workspace_id=workspace_id,
        role=link_in.role,
        expires_at=link_in.expires_at,
        password_hash=get_password_hash(link_in.password) if link_in.password else None,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _to_shared_link_response(link)


@router.get("/{workspace_id}/share", response_model=List[SharedLinkResponse])
def list_shared_links(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lists all active share links for the workspace."""
    _require_member(db, workspace_id, current_user.id)
    links = db.query(SharedLink).filter(SharedLink.workspace_id == workspace_id).all()
    return [_to_shared_link_response(link) for link in links]


@router.delete("/share/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_shared_link(
    link_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revokes a public sharing link. Admins of the owning workspace only."""
    link = db.query(SharedLink).filter(SharedLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared link not found.")

    _require_admin(db, link.workspace_id, current_user.id)

    db.delete(link)
    db.commit()


@router.post("/share/{link_id}/join", response_model=SharedLinkJoinResponse)
def join_via_shared_link(
    link_id: uuid.UUID,
    join_in: SharedLinkJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Joins the workspace behind a shared link, granting the role configured on that link."""
    link = db.query(SharedLink).filter(SharedLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared link not found or has been revoked.")

    if link.expires_at:
        link_expires = link.expires_at
        if link_expires.tzinfo is None:
            link_expires = link_expires.replace(tzinfo=datetime.timezone.utc)
        if link_expires < utcnow():
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="This shared link has expired.")

    if link.password_hash:
        if not join_in.password:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This shared link requires a password.")
        if not verify_password(join_in.password, link.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password for this shared link.")

    workspace = db.query(Workspace).filter(Workspace.id == link.workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The workspace behind this link no longer exists.")

    existing = _get_membership(db, workspace.id, current_user.id)
    if existing:
        return SharedLinkJoinResponse(workspace=workspace, role=existing.role, already_member=True)

    membership = Membership(user_id=current_user.id, workspace_id=workspace.id, role=link.role)
    db.add(membership)
    db.commit()

    return SharedLinkJoinResponse(workspace=workspace, role=membership.role, already_member=False)
