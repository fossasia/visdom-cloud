"""
Main FastAPI entrypoint. Auto-creates SQL tables, mounts routers, and configures CORS.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

from app.config import settings
from app.database import Base, engine
from app.routers import api_keys, auth, billing, health, visdom, workspaces


def _ensure_schema() -> None:
    """Creates any missing tables, tolerating another worker getting there first.

    Every worker runs this at import, so against an empty database several can clear
    create_all's existence check together and then collide on the CREATE. The losers
    see a duplicate-object error for work that has in fact just been done for them.
    Retrying once settles it, and a second failure is a real one and still raises.
    """
    try:
        Base.metadata.create_all(bind=engine)
    except SQLAlchemyError:
        Base.metadata.create_all(bind=engine)


_ensure_schema()
app = FastAPI(
    title="Visdom Gateway",
    description="Microservice authentication sidecar for Visdom",
    version="1.0.0"
)


# CORS middleware configuration, origin sourced from env (FRONTEND_URL)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Mount all endpoint routers
app.include_router(auth.router, prefix="/api/v1")
app.include_router(api_keys.router, prefix="/api/v1")
app.include_router(health.router, prefix="/api/v1")
app.include_router(workspaces.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(visdom.router, prefix="/api/v1")
