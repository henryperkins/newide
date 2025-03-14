from sqlalchemy.ext.asyncio import AsyncSession
from models import User
from logging_config import get_logger
import sentry_sdk
import config
from typing import Optional
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

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
    Notifies system administrators about an invalid hash issue.
    
    Args:
        user_id: The ID of the affected user
        email: The email address of the affected user, if available
    """
    try:
        admin_email = config.settings.ADMIN_EMAIL
        if not admin_email:
            logger.warning("Admin email not configured, skipping notification")
            return
            
        # Log the notification attempt
        logger.info(f"Sending admin notification about invalid hash for user {user_id}")
        
        # Create the message
        msg = MIMEMultipart()
        msg['From'] = config.settings.EMAIL_SENDER
        msg['To'] = admin_email
        msg['Subject'] = "SECURITY ALERT: Invalid Password Hash Detected"
        
        # Prepare the message body
        body = f"""
        A user account has been identified with an invalid password hash format.
        
        User ID: {user_id}
        User Email: {email or 'Not provided'}
        Timestamp: {datetime.utcnow().isoformat()}
        
        This issue may indicate data corruption or a security concern.
        The user has been flagged for password reset.
        
        Please investigate this issue promptly.
        """
        
        msg.attach(MIMEText(body, 'plain'))
        
        # Send the email if SMTP is configured
        if hasattr(config.settings, 'SMTP_SERVER') and config.settings.SMTP_SERVER:
            with smtplib.SMTP(config.settings.SMTP_SERVER, config.settings.SMTP_PORT) as server:
                if config.settings.SMTP_USE_TLS:
                    server.starttls()
                if config.settings.SMTP_USERNAME and config.settings.SMTP_PASSWORD:
                    server.login(config.settings.SMTP_USERNAME, config.settings.SMTP_PASSWORD)
                server.send_message(msg)
                logger.info(f"Admin notification sent for user {user_id}")
        else:
            # Alternative notification method if email is not configured
            logger.warning(f"SMTP not configured, unable to send admin notification for user {user_id}")
            
            # Still record the event in Sentry
            sentry_sdk.capture_message(
                f"Invalid hash detected for user {user_id}", 
                level="warning",
                extras={"user_id": user_id, "email": email}
            )
    except Exception as e:
        logger.error(f"Error sending admin notification: {str(e)}")
        sentry_sdk.capture_exception(e)