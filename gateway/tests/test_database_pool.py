# Copyright 2017-present, The Visdom Authors
from app.config import settings
from app.database import pool_options


def test_postgres_gets_explicit_pool_settings():
    """Assert a Postgres URL carries the configured pool size and overflow."""
    options = pool_options("postgresql://user:pw@db:5432/visdom_dev")
    assert options == {
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
    }


def test_pool_stays_inside_postgres_connection_limit():
    """Assert eight workers stay under the default max_connections of 100."""
    per_worker = settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW
    assert per_worker * 8 <= 100


def test_sqlite_gets_no_pool_settings():
    """Assert SQLite is left alone, since its pool rejects those arguments."""
    assert pool_options("sqlite://") == {}
