# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
FastAPI dependency injection utilities. Provides transactions for the database
and resolves user authentication via OAuth2 JWT Token extraction using UUID lookup.
"""

import datetime
import hashlib
import uuid
from typing import Generator

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import APIKey, Membership, User, utcnow
from app.schemas import TokenPayload
from app.security import decode_token

# OAuth2 scheme looking for JWT tokens in the Authorization header
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login", auto_error=False)


def get_db() -> Generator[Session, None, None]:
    """Provides a transactional database session and closes it when done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """
    Authenticates requests using JWT Access Tokens.
    Resolves the user identity by UUID lookup.
    Raises 401 Unauthorized if invalid/expired.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not token:
        raise credentials_exception

    try:
        payload = decode_token(token)
        user_id_str: str = payload.get("sub")
        token_type: str = payload.get("type")

        # Verify it's an access token (not a refresh token)
        if user_id_str is None or token_type != "access":
            raise credentials_exception

        token_data = TokenPayload(sub=user_id_str, type=token_type)
    except jwt.PyJWTError:
        raise credentials_exception from None

    # Query database using UUID (explicitly converted for SQLite/compatibility)
    try:
        user_id = uuid.UUID(token_data.sub)
    except (TypeError, ValueError):
        raise credentials_exception from None

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    return user


def get_api_key(
    x_api_key: str = Header(None, alias="X-API-KEY"),
    db: Session = Depends(get_db),
) -> APIKey:
    """
    Authenticates a request via the X-API-KEY header. Validates that the key
    exists, is active and unexpired, and that its owner is still active.
    Raises 401 otherwise. Scope/workspace binding is enforced separately via
    enforce_api_key_workspace_scope once the target workspace is known.
    """
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="X-API-KEY header is missing."
        )

    hashed_key = hashlib.sha256(x_api_key.encode("utf-8")).hexdigest()
    key_record = (
        db.query(APIKey)
        .filter(APIKey.hashed_key == hashed_key, APIKey.is_active.is_(True))
        .first()
    )
    if not key_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or inactive API key."
        )

    if key_record.expires_at is not None:
        expires_at = key_record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
        if utcnow() > expires_at:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="API key has expired."
            )

    if not key_record.owner or not key_record.owner.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key owner."
        )

    return key_record


def enforce_api_key_workspace_scope(
    db: Session, key: APIKey, workspace_id: uuid.UUID
) -> None:
    """
    Ensures an API key is allowed to act on a specific workspace:
      - the key's owner must be an active member of the workspace, and
      - a workspace-scoped key must have that workspace in its bound set.
    An org-scoped key works for any workspace its owner actively belongs to.
    Raises 403 otherwise.
    """
    membership = (
        db.query(Membership)
        .filter(
            Membership.workspace_id == workspace_id,
            Membership.user_id == key.user_id,
            Membership.status == "active",
        )
        .first()
    )
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This API key's owner is not a member of this workspace.",
        )

    if key.scope == "workspace":
        bound_ids = {ws.id for ws in key.workspaces}
        if workspace_id not in bound_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This API key is not scoped to this workspace.",
            )


def require_api_key_workspace_access(
    workspace_id: uuid.UUID,
    key: APIKey = Depends(get_api_key),
    db: Session = Depends(get_db),
) -> APIKey:
    """
    FastAPI dependency for routes with a `{workspace_id}` path parameter that are
    authenticated by API key. Resolves + validates the key and enforces its
    workspace scope binding, returning the key record on success.
    """
    enforce_api_key_workspace_scope(db, key, workspace_id)
    return key
