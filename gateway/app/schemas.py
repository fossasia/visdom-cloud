# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Pydantic data schemas representing the payloads for user creation, token verification,
and API key provisioning. Standardizes the fields for API validation using UUID and Email.
"""

import datetime
import uuid
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field


# --- USER SCHEMAS ---
class UserBase(BaseModel):
    email: EmailStr = Field(..., max_length=100)


class UserCreate(UserBase):
    password: str = Field(..., min_length=6, max_length=100)


class UserResponse(UserBase):
    id: uuid.UUID
    tier: str
    is_active: bool
    created_at: datetime.datetime

    model_config = ConfigDict(from_attributes=True)


# --- TOKEN SCHEMAS ---
class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: Optional[str] = None  # Typically holds the User ID (UUID string)
    type: Optional[str] = None


# --- API KEY SCHEMAS ---
class APIKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class APIKeyResponse(BaseModel):
    id: uuid.UUID
    name: str
    prefix: str
    is_active: bool
    created_at: datetime.datetime
    last_used_at: Optional[datetime.datetime] = None

    model_config = ConfigDict(from_attributes=True)


class APIKeyCreatedResponse(APIKeyResponse):
    raw_key: str  # Only returned once on creation
