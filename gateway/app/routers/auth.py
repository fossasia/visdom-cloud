
"""
Authentication router handling user registration, logins, JWT refresh rotation, and logout sessions.
"""

from app.models import APIKey, utcnow
import datetime
import hashlib
import uuid
from fastapi import APIRouter, Depends, HTTPException, Response, Request, status, Header
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
import jwt

from app.config import settings
from app.dependencies import get_db, get_current_user
from app.models import Membership, User, WorkspaceInvite
from app.schemas import (
    GeneratedUsernameResponse,
    Token,
    UsernameAvailabilityResponse,
    UsernameUpdate,
    UserCreate,
    UserResponse,
)
from app.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.username import (
    generate_unique_username,
    is_valid_username_format,
    normalize_username,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    email = user_in.email.strip().lower()
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered."
        )

    if user_in.username:
        username = normalize_username(user_in.username)
        if db.query(User).filter(User.username == username).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This username is already taken.",
            )
    else:
        username = generate_unique_username(db, seed=email.split("@")[0])

    hashed_pwd = get_password_hash(user_in.password)
    new_user = User(email=email, username=username, password_hash=hashed_pwd)

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    pending_invites = db.query(WorkspaceInvite).filter(WorkspaceInvite.email == new_user.email).all()
    for invite in pending_invites:
        db.add(
            Membership(
                user_id=new_user.id,
                workspace_id=invite.workspace_id,
                role=invite.role,
                status="pending_acceptance",
            )
        )
        db.delete(invite)
    if pending_invites:
        db.commit()

    return new_user


@router.get("/username-availability", response_model=UsernameAvailabilityResponse)
def check_username_availability(username: str, db: Session = Depends(get_db)):
    """Checks whether a username is valid and not already taken (used while typing)."""
    normalized = normalize_username(username)
    if not is_valid_username_format(normalized):
        return {"available": False}

    exists = db.query(User).filter(User.username == normalized).first()
    return {"available": exists is None}


@router.get("/generate-username", response_model=GeneratedUsernameResponse)
def generate_username_suggestion(seed: str | None = None, db: Session = Depends(get_db)):
    """Returns a fresh, available, randomly generated username suggestion."""
    return {"username": generate_unique_username(db, seed=seed)}


@router.patch("/me/username", response_model=UserResponse)
def update_username(
    payload: UsernameUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Updates the current user's username."""
    username = normalize_username(payload.username)

    if username == current_user.username:
        return current_user

    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This username is already taken.",
        )

    current_user.username = username
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/login", response_model=Token)
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """
    Validates user credentials (mapping username to email in form data).
    Returns an access token in the JSON body and sets the refresh token in an HTTP-only cookie.
    """
    user = db.query(User).filter(User.email == form_data.username.strip().lower()).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user."
        )

    # generate token payloads
    user_id_str = str(user.id)
    access_token = create_access_token(data={"sub": user_id_str})
    refresh_token = create_refresh_token(data={"sub": user_id_str})

    # set refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.COOKIE_SECURE,  # HTTPS transfer in production
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/api/v1/auth",  # scope cookie to auth endpoints
    )

    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/refresh", response_model=Token)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Validates the refresh token cookie, rotates it,
    and returns a new Access Token.
    """
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid refresh cookie."
        )

    try:
        payload = decode_token(refresh_token)
        user_id_str: str = payload.get("sub")
        token_type: str = payload.get("type")
        
        if user_id_str is None or token_type != "refresh":
            raise jwt.PyJWTError()
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token."
        )

    try:
        user_id = uuid.UUID(user_id_str)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token."
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User associated with this token is inactive or does not exist."
        )

    # Rotate both access and refresh tokens
    new_access_token = create_access_token(data={"sub": user_id_str})
    new_refresh_token = create_refresh_token(data={"sub": user_id_str})

    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/api/v1/auth",
    )

    return {"access_token": new_access_token, "token_type": "bearer"}


@router.post("/logout")
def logout(response: Response):
    """Deletes the refresh token cookie, terminating the session."""
    response.delete_cookie(key="refresh_token", path="/api/v1/auth")
    return {"detail": "Successfully logged out"}


@router.get("/me", response_model=UserResponse)
def get_user_profile(current_user: User = Depends(get_current_user)):
    """Returns the current authenticated user's profile info."""
    return current_user

@router.get("/key-check")
def check_api_key(
    x_api_key: str = Header(None, alias="X-API-KEY"),
    db: Session = Depends(get_db)
):
    """Verifies if an API Key is valid and returns the owner details"""
    if not x_api_key:
        raise HTTPException(status_code=401, detail="X-API-KEY header is missing.")

    # hash the incoming key to match the db hash
    hashed_key = hashlib.sha256(x_api_key.encode("utf-8")).hexdigest()

    # query the key in db
    key_record = (
        db.query(APIKey)
        .filter(APIKey.hashed_key == hashed_key, APIKey.is_active.is_(True))
        .first()
    )
    if not key_record:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key.")

    if key_record.expires_at is not None:
        expires_at = key_record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
        if utcnow() > expires_at:
            raise HTTPException(status_code=401, detail="API key has expired.")

    # return user detail
    user = db.query(User).filter(User.id == key_record.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid API key owner.")
    return {"status": "authenticated", "email": user.email, "key_name": key_record.name}
