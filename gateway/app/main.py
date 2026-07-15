"""
Main FastAPI entrypoint. Auto-creates SQL tables, mounts routers, and configures CORS.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import Base, engine
from app.routers import auth, api_keys, health, workspaces

# Create db tables on startup
Base.metadata.create_all(bind=engine)
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