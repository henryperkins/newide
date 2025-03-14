from sqlalchemy.ext.asyncio import AsyncSession
from models import User
from logging_config import get_logger
import sentry_sdk
import config
from typing import Optional
from datetime import datetime

# Import the email service
from services.email_service import email_service

# Set up logger
logger = get_logger(__name__)

async def flag_user_for_password_reset(db_session: AsyncSession, user_id: str) -> None:
    """
    Flags a user as requiring a password reset due to invalid hash format.
    
    Args:
        db_session: The database session
        user_id: The ID of the user to flag
    """
    try:
        user = await db_session.get(User, user_id)
        if user:
            # Set a flag in the user record
            user.requires_password_reset = True
            user.password_reset_reason = "Invalid hash format detected"
            user.updated_at = datetime.utcnow()
            
            # Commit the changes
            await db_session.commit()
            
            logger.info(f"Flagged user {user_id} for password reset due to invalid hash format")
            
            # Add a breadcrumb for tracking
            sentry_sdk.add_breadcrumb(
                category="auth",
                message=f"User {user_id} flagged for password reset - invalid hash",
                level="info"
            )
    except Exception as e:
        logger.error(f"Error flagging user {user_id} for password reset: {str(e)}")
        sentry_sdk.capture_exception(e)
        await db_session.rollback()

async def notify_admin_about_hash_issue(user_id: str, email: Optional[str] = None) -> None:
    """
    Notifies system administrators about an invalid hash issue using SendGrid.
    
    Args:
        user_id: The ID of the affected user
        email: The email address of the affected user, if available
    """
    try:
        # Log the notification attempt
        logger.info(f"Sending admin notification about invalid hash for user {user_id}")
        
        # Prepare the message
        subject = "SECURITY ALERT: Invalid Password Hash Detected"
        
        message = f"""
        A user account has been identified with an invalid password hash format.
        
        The user has been flagged for password reset.
        
        Please investigate this issue promptly.
        """
        
        # Prepare event data
        event_data = {
            "User ID": user_id,
            "User Email": email or "Not provided",
            "Timestamp": datetime.utcnow().isoformat(),
            "Issue Type": "Invalid Password Hash",
            "Action Taken": "User flagged for password reset"
        }
        
        # Send the notification via email service
        sent = await email_service.send_admin_notification(
            subject=subject,
            message=message,
            event_data=event_data
        )
        
        if sent:
            logger.info(f"Admin notification sent for user {user_id}")
        else:
            logger.warning(f"Failed to send admin notification for user {user_id}")
            
            # Still record the event in Sentry
            sentry_sdk.capture_message(
                f"Invalid hash detected for user {user_id}", 
                level="warning",
                extras={"user_id": user_id, "email": email}
            )
            
    except Exception as e:
        logger.error(f"Error sending admin notification: {str(e)}")
        sentry_sdk.capture_exception(e)

async def generate_password_reset_token(user_id: str, expires_in_minutes: int = 60) -> str:
    """
    Generate a secure token for password reset.
    
    Args:
        user_id: The ID of the user
        expires_in_minutes: Token expiration time in minutes
        
    Returns:
        str: A secure reset token
    """
    import secrets
    import jwt
    from datetime import datetime, timedelta
    
    # Generate payload with user ID and expiration
    expiration = datetime.utcnow() + timedelta(minutes=expires_in_minutes)
    payload = {
        "sub": user_id,
        "exp": expiration,
        "iat": datetime.utcnow(),
        "type": "password_reset",
        "jti": secrets.token_hex(16)  # Add a unique identifier
    }
    
    # Generate JWT token
    token = jwt.encode(payload, config.settings.JWT_SECRET, algorithm="HS256")
    
    return token

async def verify_password_reset_token(token: str) -> Optional[str]:
    """
    Verify a password reset token.
    
    Args:
        token: The password reset token
        
    Returns:
        Optional[str]: The user ID if token is valid, None otherwise
    """
    import jwt
    from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
    
    try:
        # Decode and verify the token
        payload = jwt.decode(token, config.settings.JWT_SECRET, algorithms=["HS256"])
        
        # Check token type
        if payload.get("type") != "password_reset":
            logger.warning("Invalid token type for password reset")
            return None
        
        # Return the user ID
        return payload.get("sub")
        
    except ExpiredSignatureError:
        logger.warning("Expired password reset token")
        return None
        
    except InvalidTokenError as e:
        logger.warning(f"Invalid password reset token: {str(e)}")
        return None
        
    except Exception as e:
        logger.error(f"Error verifying password reset token: {str(e)}")
        sentry_sdk.capture_exception(e)
        return None

async def initiate_password_reset(db_session: AsyncSession, email: str) -> bool:
    """
    Initiate the password reset process for a user.
    
    Args:
        db_session: The database session
        email: The email address of the user
        
    Returns:
        bool: True if reset was initiated successfully, False otherwise
    """
    from sqlalchemy import select
    
    try:
        # Find the user by email
        stmt = select(User).where(User.email == email)
        result = await db_session.execute(stmt)
        user = result.scalars().first()
        
        if not user:
            logger.warning(f"Password reset requested for non-existent email: {email}")
            return False
        
        # Generate reset token
        token = await generate_password_reset_token(str(user.id))
        
        # Send reset email
        sent = await email_service.send_password_reset_email(
            to_email=email,
            reset_token=token,
            user_id=str(user.id)
        )
        
        if sent:
            logger.info(f"Password reset email sent to {email}")
            return True
        else:
            logger.warning(f"Failed to send password reset email to {email}")
            return False
            
    except Exception as e:
        logger.error(f"Error initiating password reset: {str(e)}")
        sentry_sdk.capture_exception(e)
        return False