from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from passlib.hash import bcrypt
import jwt
from datetime import datetime, timedelta

from pydantic_models import UserCreate, UserLogin
from database import get_db_session
from models import User
import uuid
import config
from sqlalchemy import select


router = APIRouter(tags=["auth"])


@router.post("/register")
async def register_user(
    form: UserCreate,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Registers a new user, ensuring their email does not already exist.
    """
    stmt = select(User).where(User.email == form.email)
    result = await db.execute(stmt)
    if result.scalars().first():
        raise HTTPException(
            status_code=400,
            detail="Email already exists"
        )

    # Hash the password before storing
    hashed = bcrypt.hash(form.password)
    new_user = User(
        id=str(uuid.uuid4()),
        email=form.email,
        hashed_password=hashed
    )
    db.add(new_user)
    await db.commit()
    return {"message": "User registered successfully"}


@router.post("/login")
async def login_user(
    form: UserLogin,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Logs in an existing user, verifying credentials against the database.
    """
    stmt = select(User).where(User.email == form.email)
    result = await db.execute(stmt)
    user = result.scalars().first()
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials"
        )

    if not bcrypt.verify(form.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials"
        )

    # Generate JWT token
    payload = {
        "sub": user.email,
        "user_id": str(user.id),
        "exp": datetime.utcnow() + timedelta(minutes=60),
        "iat": datetime.utcnow(),
    }
    token = jwt.encode(payload, config.settings.JWT_SECRET, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer"}
