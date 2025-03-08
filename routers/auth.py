from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from passlib.hash import bcrypt
import jwt as pyjwt
from datetime import datetime, timedelta
import time
import uuid
import sentry_sdk

from pydantic_models import UserCreate, UserLogin
from database import get_db_session
from models import User
import config
from sqlalchemy import select
from services.tracing_utils import trace_function, trace_block, set_user_context, add_breadcrumb
from logging_config import get_logger

# Set up logger
logger = get_logger(__name__)

router = APIRouter(tags=["auth"])


@router.post("/register")
@trace_function(op="auth.register", name="register_user")
async def register_user(
    form: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Registers a new user, ensuring their email does not already exist.
    """
    # Create a transaction for user registration
    transaction = sentry_sdk.start_transaction(
        name="user_registration",
        op="auth.register"
    )
    
    # Capture client info
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    transaction.set_data("client.ip", client_ip)
    transaction.set_data("client.user_agent", user_agent)
    
    start_time = time.time()
    
    try:
        # Check for existing email
        with trace_block("Check Email Exists", op="db.query") as span:
            stmt = select(User).where(User.email == form.email)
            result = await db.execute(stmt)
            existing_user = result.scalars().first()
            
            if existing_user:
                span.set_data("email_exists", True)
                transaction.set_data("registration_success", False)
                transaction.set_data("failure_reason", "email_exists")
                
                logger.warning(
                    f"Registration failed - email already exists: {form.email}",
                    extra={"email": form.email, "ip": client_ip}
                )
                
                add_breadcrumb(
                    category="auth",
                    message=f"Registration failed - email exists",
                    level="warning",
                    data={"email": form.email}
                )
                
                raise HTTPException(
                    status_code=400,
                    detail="Email already exists"
                )
            
            span.set_data("email_exists", False)
        
        # Hash password
        with trace_block("Hash Password", op="auth.hash_password") as span:
            password_start = time.time()
            hashed = bcrypt.hash(form.password)
            span.set_data("duration_seconds", time.time() - password_start)
        
        # Create user
        with trace_block("Create User", op="db.insert") as span:
            user_id = str(uuid.uuid4())
            new_user = User(
                id=user_id,
                email=form.email,
                hashed_password=hashed
            )
            
            span.set_data("user_id", user_id)
            db.add(new_user)
            await db.commit()
        
        # Set transaction data
        duration = time.time() - start_time
        transaction.set_data("registration_success", True)
        transaction.set_data("duration_seconds", duration)
        
        # Log success
        logger.info(
            f"User registered successfully: {form.email}",
            extra={"user_id": user_id, "email": form.email, "duration": duration}
        )
        
        add_breadcrumb(
            category="auth",
            message="User registered successfully",
            level="info",
            data={"user_id": user_id, "email": form.email}
        )
        
        return {"message": "User registered successfully", "user_id": user_id}
        
    except Exception as e:
        # Set error information in transaction
        transaction.set_data("registration_success", False)
        transaction.set_data("error.type", e.__class__.__name__)
        
        # Don't expose the full error in the transaction to avoid leaking sensitive info
        if not isinstance(e, HTTPException):
            transaction.set_data("error.message", "Internal error during registration")
            # Capture the full exception for monitoring
            sentry_sdk.capture_exception(e)
            
            logger.error(
                f"Registration error: {str(e)}",
                extra={"email": form.email, "error": str(e)}
            )
            
            # Convert to HTTPException
            raise HTTPException(
                status_code=500,
                detail="An error occurred during registration"
            )
        else:
            # Pass through HTTPExceptions with their status and detail
            transaction.set_data("error.message", e.detail)
            raise
            
    finally:
        # Finish the transaction
        transaction.finish()


@router.post("/login")
@trace_function(op="auth.login", name="login_user")
async def login_user(
    form: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Logs in an existing user, verifying credentials against the database.
    """
    # Create a transaction for user login
    transaction = sentry_sdk.start_transaction(
        name="user_login",
        op="auth.login"
    )
    
    # Capture client info
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    transaction.set_data("client.ip", client_ip)
    transaction.set_data("client.user_agent", user_agent)
    
    # Mask email in transaction to avoid PII in Sentry
    masked_email = form.email.split('@')[0][0:3] + "***@" + form.email.split('@')[1]
    transaction.set_data("masked_email", masked_email)
    
    start_time = time.time()
    
    try:
        # Look up user
        with trace_block("Find User", op="db.query") as span:
            stmt = select(User).where(User.email == form.email)
            result = await db.execute(stmt)
            user = result.scalars().first()
            
            if not user:
                span.set_data("user_found", False)
                transaction.set_data("login_success", False)
                transaction.set_data("failure_reason", "invalid_credentials")
                
                # Add breadcrumb for failed login
                add_breadcrumb(
                    category="auth",
                    message="Login failed - user not found",
                    level="warning",
                    data={"masked_email": masked_email}
                )
                
                logger.warning(
                    f"Login failed - user not found: {masked_email}",
                    extra={"masked_email": masked_email, "ip": client_ip}
                )
                
                raise HTTPException(
                    status_code=401,
                    detail="Invalid credentials"
                )
                
            span.set_data("user_found", True)
            span.set_data("user_id", str(user.id))
        
        # Verify password
        with trace_block("Verify Password", op="auth.verify_password") as span:
            verify_start = time.time()
            valid_password = bcrypt.verify(form.password, user.hashed_password)
            span.set_data("duration_seconds", time.time() - verify_start)
            span.set_data("password_valid", valid_password)
            
            if not valid_password:
                transaction.set_data("login_success", False)
                transaction.set_data("failure_reason", "invalid_password")
                
                # Add breadcrumb for failed login
                add_breadcrumb(
                    category="auth",
                    message="Login failed - invalid password",
                    level="warning",
                    data={"user_id": str(user.id)}
                )
                
                logger.warning(
                    f"Login failed - invalid password for user: {str(user.id)}",
                    extra={"user_id": str(user.id), "ip": client_ip}
                )
                
                raise HTTPException(
                    status_code=401,
                    detail="Invalid credentials"
                )
                
        # Generate JWT token
        with trace_block("Generate Token", op="auth.jwt_token") as span:
            token_start = time.time()
            
            # Set expiration time
            expiration = datetime.utcnow() + timedelta(minutes=60)
            
            payload = {
                "sub": user.email,
                "user_id": str(user.id),
                "exp": expiration,
                "iat": datetime.utcnow(),
            }
            
            token = pyjwt.encode(payload, config.settings.JWT_SECRET, algorithm="HS256")
            span.set_data("duration_seconds", time.time() - token_start)
            
        # Set user context for Sentry
        set_user_context(user_id=str(user.id), email=user.email)
        
        # Record successful login
        duration = time.time() - start_time
        transaction.set_data("login_success", True)
        transaction.set_data("duration_seconds", duration)
        
        # Add success breadcrumb
        add_breadcrumb(
            category="auth",
            message="User logged in successfully",
            level="info",
            data={"user_id": str(user.id)}
        )
        
        logger.info(
            f"User logged in successfully: {str(user.id)}",
            extra={"user_id": str(user.id), "duration": duration}
        )
        
        return {"access_token": token, "token_type": "bearer", "user_id": str(user.id)}
        
    except Exception as e:
        # Set error information
        transaction.set_data("login_success", False)
        transaction.set_data("error.type", e.__class__.__name__)
        
        if not isinstance(e, HTTPException):
            transaction.set_data("error.message", "Internal error during login")
            # Capture the full exception for monitoring
            sentry_sdk.capture_exception(e)
            
            logger.error(
                f"Login error: {str(e)}",
                extra={"masked_email": masked_email, "error": str(e)}
            )
            
            # Convert to HTTPException
            raise HTTPException(
                status_code=500,
                detail="An error occurred during login"
            )
        else:
            # Pass through HTTPExceptions
            transaction.set_data("error.message", e.detail)
            raise
            
    finally:
        # Finish the transaction
        transaction.finish()
