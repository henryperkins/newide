from fastapi import APIRouter, Depends, HTTPException, Request, Form, Header, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from passlib.hash import bcrypt_sha256 as bcrypt
from jose import jwt, JWTError
from datetime import datetime, timedelta
import time
import uuid
import sentry_sdk
from typing import Optional

# Moved these imports to top-level to avoid "import-outside-toplevel"
from sqlalchemy import select
from services.auth_service import generate_password_reset_token, verify_password_reset_token, flag_user_for_password_reset

from services.background_tasks import (
    send_welcome_email_background,
    send_login_notification_background,
    send_admin_notification_background,
    send_password_reset_email_background
)
from pydantic_models import UserCreate
from database import get_db_session
from models import User
from config import settings  # Ensure config.py has a global "settings"
from services.tracing_utils import trace_function, trace_block, set_user_context, add_breadcrumb
from logging_config import get_logger
from services.session_service import SessionService

# Set up logger
logger = get_logger(__name__)

def send_admin_notification(user_email: str, reason: str, ip: str = "unknown"):
    """
    Send notification to admin about failed login attempts or other security events.
    
    Args:
        user_email: The email address that attempted to login
        reason: The reason for the notification
        ip: The IP address where the attempt came from
    """
    if not settings.ADMIN_EMAIL:
        logger.warning("Admin notification attempted but ADMIN_EMAIL is not configured")
        return
    
    # Log usage of 'ip' to avoid "unused argument" lint warning:
    logger.info(f"Admin notification queued from IP: {ip} for {user_email}: {reason}")


router = APIRouter(tags=["auth"])


@router.post("/register")
@trace_function(op="auth.register", name="register_user")
async def register_user(
    background_tasks: BackgroundTasks,  # Add background_tasks parameter
    form: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Registers a new user, ensuring their email does not already exist.
    """
    transaction = sentry_sdk.start_transaction(
        name="user_registration",
        op="auth.register"
    )
    
    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    transaction.set_data("client.ip", client_ip)
    transaction.set_data("client.user_agent", user_agent)
    
    start_time = time.time()
    
    try:
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
                    message="Registration failed - email exists",
                    level="warning",
                    data={"email": form.email}
                )
                
                raise HTTPException(
                    status_code=400,
                    detail="Email already exists"
                )
            
            span.set_data("email_exists", False)
        
        with trace_block("Hash Password", op="auth.hash_password") as span:
            password_start = time.time()
            hashed = bcrypt.hash(form.password)
            span.set_data("duration_seconds", time.time() - password_start)
            
            try:
                bcrypt.identify(hashed)
            except Exception as e:
                logger.error(f"Generated invalid hash format: {str(e)}")
                transaction.set_data("registration_success", False)
                transaction.set_data("failure_reason", "invalid_hash_format")
                sentry_sdk.capture_exception(e)
                raise HTTPException(
                    status_code=500,
                    detail="Error during user registration"
                ) from e
        
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
        
        with trace_block("Schedule Welcome Email", op="email.welcome") as span:
            background_tasks.add_task(
                send_welcome_email_background,
                to_email=form.email,
                user_id=user_id
            )
            span.set_data("email_scheduled", True)
            logger.info(f"Welcome email scheduled for {form.email}")
        
        duration = time.time() - start_time
        transaction.set_data("registration_success", True)
        transaction.set_data("duration_seconds", duration)
        transaction.set_data("welcome_email_scheduled", True)
        
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
        transaction.set_data("registration_success", False)
        transaction.set_data("error.type", e.__class__.__name__)
        
        if not isinstance(e, HTTPException):
            transaction.set_data("error.message", "Internal error during registration")
            sentry_sdk.capture_exception(e)
            
            logger.error(
                f"Registration error: {str(e)}",
                extra={"email": form.email, "error": str(e)}
            )
            
            raise HTTPException(
                status_code=500,
                detail="An error occurred during registration"
            ) from e
        else:
            transaction.set_data("error.message", e.detail if hasattr(e, "detail") else str(e))
            raise
    finally:
        transaction.finish()


@router.post("/login")
@trace_function(op="auth.login", name="login_user")
async def login_user(
    background_tasks: BackgroundTasks,  # Add background_tasks parameter
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Logs in an existing user, verifying credentials against the database.
    """
    transaction = sentry_sdk.start_transaction(
        name="user_login",
        op="auth.login"
    )

    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    transaction.set_data("client.ip", client_ip)
    transaction.set_data("client.user_agent", user_agent)

    masked_email = email.split('@')[0][0:3] + "***@" + email.split('@')[1]
    transaction.set_data("masked_email", masked_email)

    start_time = time.time()

    try:
        with trace_block("Find User", op="db.query") as span:
            stmt = select(User).where(User.email == email)
            result = await db.execute(stmt)
            user = result.scalars().first()

            if not user:
                span.set_data("user_found", False)
                transaction.set_data("login_success", False)
                transaction.set_data("failure_reason", "invalid_credentials")

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

        with trace_block("Verify Password", op="auth.verify_password") as span:
            verify_start = time.time()
            try:
                valid_password = bcrypt.verify(password, str(user.hashed_password))
                span.set_data("duration_seconds", time.time() - verify_start)
                span.set_data("password_valid", valid_password)

                if not valid_password:
                    transaction.set_data("login_success", False)
                    transaction.set_data("failure_reason", "invalid_password")

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
            except ValueError as e:
                logger.error(f"Invalid password hash format for user {user.id}: {str(e)}")
                
                await flag_user_for_password_reset(db, str(user.id))

                background_tasks.add_task(
                    send_admin_notification_background,
                    subject="Invalid Password Hash Detected",
                    message=(
                        f"User {user.id} has an invalid password hash format. "
                        f"The user has been flagged for password reset."
                    ),
                    event_data={
                        "User ID": str(user.id),
                        "User Email": user.email,
                        "IP Address": client_ip,
                        "Timestamp": datetime.utcnow().isoformat()
                    }
                )
                
                transaction.set_data("login_success", False)
                transaction.set_data("failure_reason", "invalid_hash_format")
                
                add_breadcrumb(
                    category="auth",
                    message="Login failed - invalid hash format",
                    level="error",
                    data={"user_id": str(user.id)}
                )
                
                raise HTTPException(
                    status_code=401,
                    detail="Account requires password reset."
                ) from e

        with trace_block("Generate Token", op="auth.jwt_token") as span:
            token_start = time.time()

            expiration = datetime.utcnow() + timedelta(minutes=60)

            payload = {
                "sub": user.email,
                "user_id": str(user.id),
                "exp": expiration,
                "iat": datetime.utcnow(),
            }

            token = jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")
            span.set_data("duration_seconds", time.time() - token_start)

        with trace_block("Create User Session", op="auth.create_session") as session_span:
            session_start = time.time()

            new_session = await SessionService.create_session(
                db_session=db,
                user_id=str(user.id)
            )

            session_span.set_data("session_id", str(new_session.id))
            session_span.set_data("duration_seconds", time.time() - session_start)

        with trace_block("Schedule Login Notification", op="email.login_notification") as email_span:
            background_tasks.add_task(
                send_login_notification_background,
                to_email=email,
                user_id=str(user.id),
                ip_address=client_ip,
                user_agent=user_agent
            )
            email_span.set_data("email_scheduled", True)
            logger.info(f"Login notification email scheduled for {masked_email}")

        set_user_context(user_id=str(user.id), email=str(user.email))

        duration = time.time() - start_time
        transaction.set_data("login_success", True)
        transaction.set_data("duration_seconds", duration)
        transaction.set_data("session_id", str(new_session.id))
        transaction.set_data("login_notification_scheduled", True)

        add_breadcrumb(
            category="auth",
            message="User logged in successfully",
            level="info",
            data={"user_id": str(user.id), "session_id": str(new_session.id)}
        )

        logger.info(
            f"User logged in successfully: {str(user.id)}",
            extra={"user_id": str(user.id), "session_id": str(new_session.id), "duration": duration}
        )

        return {
            "access_token": token,
            "token_type": "bearer",
            "user_id": str(user.id),
            "session_id": str(new_session.id)
        }

    except Exception as e:
        transaction.set_data("login_success", False)
        transaction.set_data("error.type", e.__class__.__name__)

        if not isinstance(e, HTTPException):
            transaction.set_data("error.message", "Internal error during login")
            sentry_sdk.capture_exception(e)

            logger.error(
                f"Login error: {str(e)}",
                extra={"masked_email": masked_email, "error": str(e)}
            )

            raise HTTPException(
                status_code=500,
                detail="An error occurred during login"
            ) from e
        else:
            transaction.set_data("error.message", e.detail if hasattr(e, "detail") else str(e))
            raise
    finally:
        transaction.finish()


@router.post("/forgot-password")
@trace_function(op="auth.forgot_password", name="forgot_password")
async def forgot_password(
    background_tasks: BackgroundTasks,
    request: Request,
    email: str = Form(...),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Initiates the password reset process for a user.
    """
    transaction = sentry_sdk.start_transaction(
        name="forgot_password",
        op="auth.forgot_password"
    )
    
    client_ip = request.client.host if request.client else "unknown"
    transaction.set_data("client.ip", client_ip)
    
    masked_email = email.split('@')[0][0:3] + "***@" + email.split('@')[1]
    transaction.set_data("masked_email", masked_email)
    
    try:
        stmt = select(User).where(User.email == email)
        result = await db.execute(stmt)
        user = result.scalars().first()
        
        if user:
            token = await generate_password_reset_token(str(user.id))
            
            background_tasks.add_task(
                send_password_reset_email_background,
                to_email=email,
                reset_token=token,
                user_id=str(user.id)
            )
            
            logger.info(f"Password reset email scheduled for {masked_email}")
            transaction.set_data("email_found", True)
            transaction.set_data("reset_email_scheduled", True)
        else:
            logger.info(f"Password reset attempted for non-existent email: {masked_email}")
            transaction.set_data("email_found", False)
        
        transaction.set_status("ok")
        return {"message": "If your email is registered, you will receive a password reset link"}
        
    except Exception as e:
        logger.error(f"Error in forgot_password: {str(e)}")
        sentry_sdk.capture_exception(e)
        transaction.set_data("error", str(e))
        transaction.set_status("error")
        
        return {"message": "If your email is registered, you will receive a password reset link"}
        
    finally:
        transaction.finish()


@router.get("/validate-token")
@trace_function(op="auth.validate", name="validate_token")
async def validate_token(
    _request: Request,  # Renamed to _request to avoid "unused-argument" lint warning
    token: Optional[str] = Header(None, alias="Authorization")
):
    """
    Validates a JWT token to ensure it's still valid.
    This endpoint is used for client-side authentication checks.
    """
    transaction = sentry_sdk.start_transaction(
        name="token_validation",
        op="auth.validate"
    )
    
    if token and token.startswith("Bearer "):
        token = token.replace("Bearer ", "")
    
    if not token:
        transaction.set_data("token_provided", False)
        transaction.set_status("invalid_arguments")
        transaction.finish()
        return {"valid": False, "reason": "No token provided"}
    
    transaction.set_data("token_provided", True)
    
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=["HS256"],
            options={"require": ["exp", "iat"]}
        )
        
        user_id = payload.get("user_id")
        if not user_id:
            transaction.set_data("reason", "missing_user_id")
            transaction.set_status("invalid_token")
            transaction.finish()
            return {"valid": False, "reason": "Invalid token format"}
            
        transaction.set_data("user_id", user_id)
        transaction.set_status("ok")
        transaction.finish()
        
        exp_timestamp = payload.get("exp")
        expires_at = datetime.fromtimestamp(exp_timestamp).isoformat() if exp_timestamp else None
        
        return {
            "valid": True,
            "user_id": user_id,
            "expires_at": expires_at
        }
        
    except JWTError as e:
        error_type = "Token has expired" if "expired" in str(e) else str(e)
        
        # Log more detailed info for monitoring
        if "expired" in str(e):
            logger.info("Token validation failed: Signature has expired")
            transaction.set_data("reason", "Signature has expired")
        else:
            logger.warning(f"Token validation failed: {str(e)}")
            transaction.set_data("reason", str(e))
            
        transaction.set_status("invalid_token")
        transaction.finish()
        return {"valid": False, "reason": error_type}
        
    except Exception as e:
        logger.error(f"Error validating token: {str(e)}")
        sentry_sdk.capture_exception(e)
        transaction.set_data("error", str(e))
        transaction.set_status("internal_error")
        transaction.finish()
        return {"valid": False, "reason": "Error validating token"}


@router.post("/reset-password")
@trace_function(op="auth.reset_password", name="reset_password")
async def reset_password(
    request: Request,
    token: str = Form(...),
    new_password: str = Form(...),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Resets a user's password using a valid reset token.
    
    This endpoint:
    1. Validates the reset token
    2. Updates the user's password
    3. Clears any password reset flags
    
    Args:
        token: The reset token from the email
        new_password: The new password
    """
    transaction = sentry_sdk.start_transaction(
        name="reset_password",
        op="auth.reset_password"
    )
    
    client_ip = request.client.host if request.client else "unknown"
    transaction.set_data("client.ip", client_ip)
    
    try:
        user_id = await verify_password_reset_token(token)
        
        if not user_id:
            transaction.set_data("token_valid", False)
            transaction.set_status("invalid_token")
            
            logger.warning("Invalid or expired password reset token")
            
            raise HTTPException(
                status_code=400,
                detail="Invalid or expired password reset token"
            )
            
        transaction.set_data("token_valid", True)
        transaction.set_data("user_id", user_id)
        
        user = await db.get(User, user_id)
        
        if not user:
            transaction.set_data("user_found", False)
            transaction.set_status("user_not_found")
            
            logger.warning(f"User not found for password reset: {user_id}")
            
            raise HTTPException(
                status_code=404,
                detail="User not found"
            )
            
        transaction.set_data("user_found", True)
        
        hash_start = time.time()
        hashed_password = bcrypt.hash(new_password)
        transaction.set_data("hash_duration", time.time() - hash_start)
        
        # Type ignore usage for SQLAlchemy fields that might not be typed
        user.hashed_password = hashed_password  # type: ignore
        user.requires_password_reset = bool(False)  # type: ignore
        user.password_reset_reason = None  # type: ignore
        user.updated_at = datetime.utcnow()
        
        await db.commit()
        
        transaction.set_status("ok")
        
        logger.info(f"Password reset successful for user {user_id}")
        
        return {"message": "Password reset successful"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in reset_password: {str(e)}")
        sentry_sdk.capture_exception(e)
        
        transaction.set_data("error", str(e))
        transaction.set_status("error")
        
        raise HTTPException(
            status_code=500,
            detail="An error occurred during password reset"
        ) from e
    finally:
        transaction.finish()
