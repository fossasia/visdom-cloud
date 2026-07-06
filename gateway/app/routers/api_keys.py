
"""
API Key router to issue, list, and revoke programmatic authentication tokens for remote scripts.
"""

import hashlib
import secrets
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies import get_db, get_current_user
from app.models import APIKey, User
from app.schemas import APIKeyCreate, APIKeyResponse, APIKeyCreatedResponse

router = APIRouter(prefix="/keys", tags=["keys"])

@router.post("", response_model=APIKeyCreatedResponse, status_code=status.HTTP_201_CREATED)
def create_api_key(
    key_in: APIKeyCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generates a secure API key, stores its prefix & SHA-256 hash in DB,
    and returns the raw key to the user (only displayed once).
    """
    # Generate key: "vis_live_" + 32 random characters
    raw_secret = secrets.token_hex(16)
    prefix = "vis_live"
    raw_key = f"{prefix}_{raw_secret}"

    # Hash the key using SHA-256
    hashed_key = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()

    # Save to database
    db_key = APIKey(
        name=key_in.name,
        prefix=f"{prefix}_{raw_secret[:6]}...",  # Displayable mask
        hashed_key=hashed_key,
        user_id=current_user.id
    )
    
    db.add(db_key)
    db.commit()
    db.refresh(db_key)

    # Attach the raw key to response schema
    
    return APIKeyCreatedResponse(
        id=db_key.id,
        name=db_key.name,
        prefix=db_key.prefix,
        is_active=db_key.is_active,
        created_at=db_key.created_at,
        last_used_at=db_key.last_used_at,
        raw_key=raw_key
    )


@router.get("", response_model=List[APIKeyResponse])
def list_api_keys(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Lists all active API keys associated with the authenticated user."""
    return db.query(APIKey).filter(APIKey.user_id == current_user.id).all()


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_key(
    key_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revokes (deletes) a specific API key belonging to the user."""
    key = db.query(APIKey).filter(
        APIKey.id == key_id,
        APIKey.user_id == current_user.id
    ).first()
    
    if not key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API Key not found or does not belong to you."
        )

    db.delete(key)
    db.commit()
