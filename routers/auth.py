from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from passlib.hash import bcrypt
import jwt

from pydantic_models import UserCreate, UserLogin
from database import get_db_session
from models import User
import uuid
import config
from sqlalchemy import text

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register")
async def register_user(form: UserCreate, db: AsyncSession = Depends(get_db_session)):
    # Check if email is in use
    existing = await db.execute(text("SELECT 1 FROM users WHERE email=:email"), {"email": form.email})
    if existing.scalar():
        raise HTTPException(status_code=400, detail="Email already exists")
    
    # Hash password
    hashed = bcrypt.hash(form.password)
    new_user = User(id=str(uuid.uuid4()), email=form.email, hashed_password=hashed)
    db.add(new_user)
    await db.commit()
    return {"message": "User registered successfully"}

@router.post("/login")
async def login_user(form: UserLogin, db: AsyncSession = Depends(get_db_session)):
    result = await db.execute(text("SELECT * FROM users WHERE email=:email"), {"email": form.email})
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = row.User
    if not bcrypt.verify(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Generate JWT
    payload = {
        "sub": user.email,
        "user_id": user.id,
        "exp": datetime.utcnow() + timedelta(minutes=60),
        "iat": datetime.utcnow()
    }
    token = jwt.encode(payload, config.settings.JWT_SECRET, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer"}
