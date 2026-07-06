# Copyright 2017-present, The Visdom Authors
# All rights reserved.
#
# This source code is licensed under the license found in the
# LICENSE file in the root directory of this source tree.

"""
Loads configuration settings from environment variables or a local .env file.
Manages database paths, JWT encryption secrets, and token expiration times.
"""

from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Default connection string for local PostgreSQL
    DATABASE_URL: str = "postgresql://postgres:root@localhost:5432/visdom_cloud"
    JWT_SECRET: str = "dev-only-insecure-secret-change-me-0123456789"  # Change in production!
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    class Config:
        env_file = ".env"

settings = Settings()
