# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Contains security utilities for Bcrypt password hashing and JWT token creation.
Manages signing and decoding claims for short-lived access and long-lived refresh tokens.
"""

import datetime
from typing import Any, Dict, Optional

import jwt
from bcrypt import checkpw, gensalt, hashpw

from app.config import settings


# 1. Password Hashing via Bcrypt
def get_password_hash(password: str) -> str:
    """Hashes a plain-text password using Bcrypt."""
    password_bytes = password.encode('utf-8')
    hashed = hashpw(password_bytes, gensalt())
    return hashed.decode('utf-8')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain-text password against a Bcrypt hash."""
    return checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


# 2. JWT Generation & Validation
def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None) -> str:
    """Generates a short-lived JWT access token."""
    to_encode = data.copy()
    now = datetime.datetime.now(datetime.timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + datetime.timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict, expires_delta: Optional[datetime.timedelta] = None) -> str:
    """Generates a long-lived JWT refresh token."""
    to_encode = data.copy()
    now = datetime.datetime.now(datetime.timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + datetime.timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> Dict[str, Any]:
    """Decodes a JWT and verifies signature/expiration. Raises PyJWTError if invalid."""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
