# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Defines the database schema and SQLAlchemy ORM models for Users and APIKeys.
Uses UUIDs for primary keys to align with the PostgreSQL production specification.
"""

import datetime
import uuid

def utcnow() -> datetime.datetime:
    """Timezone-aware replacement for the deprecated datetime.utcnow()."""
    return datetime.datetime.now(datetime.timezone.utc)
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    stripe_customer_id = Column(String, nullable=True)
    tier = Column(String, default="free")  # free, pro, enterprise
    is_staff = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    # Relationships
    api_keys = relationship("APIKey", back_populates="owner", cascade="all, delete-orphan")


class APIKey(Base):
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)  # e.g., "training-cluster"
    prefix = Column(String, nullable=False)  # e.g., "vis_live"
    hashed_key = Column(String, unique=True, index=True, nullable=False)  # SHA-256 hash
    is_active = Column(Boolean, default=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    last_used_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    owner = relationship("User", back_populates="api_keys")
