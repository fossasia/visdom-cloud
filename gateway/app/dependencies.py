# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
FastAPI dependency injection utilities. Provides transactions for the database
and resolves user authentication via OAuth2 JWT Token extraction using UUID lookup.
"""

from typing import Generator
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
import jwt

from app.config import settings
from app.database import SessionLocal
from app.models import User
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
        raise credentials_exception
        
    # Query database using UUID string (SQLAlchemy converts automatically)
    user = db.query(User).filter(User.id == token_data.sub).first()
    if user is None:
        raise credentials_exception
        
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Inactive user"
        )
        
    return user
