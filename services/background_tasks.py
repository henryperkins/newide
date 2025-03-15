"""
Service for handling background tasks.
"""
import sentry_sdk
import time
from typing import Optional, Dict

from logging_config import get_logger

# Set up logger
logger = get_logger(__name__)

# Email background task handler
def send_email_background(
    email_fn_name: str,
    **kwargs
):
    """
    Generic background task handler for sending emails.
    
    Args:
        email_fn_name: The name of the email service function to call
        **kwargs: Arguments to pass to the email function
    """
    import asyncio  # Import locally to avoid circular imports
    from services.email_service import email_service
    
    async def _send_email():
        try:
            # Log detailed debug info
            logger.info(f"Executing email background task: {email_fn_name}")
            logger.info(f"Email task parameters: {', '.join(f'{k}={v}' for k, v in kwargs.items() if k != 'reset_token')}")
            
            # Get the email function and call it
            email_fn = getattr(email_service, email_fn_name)
            result = await email_fn(**kwargs)
            
            # Log the result
            logger.info(f"Email send result ({email_fn_name}): {result}")
            
        except Exception as e:
            logger.error(f"Background email task error ({email_fn_name}): {str(e)}")
            # Log exception details for debugging
            import traceback
            logger.error(f"Email error details: {traceback.format_exc()}")
            sentry_sdk.capture_exception(e)
    
    # Run the async function in a new event loop
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_send_email())
    finally:
        duration = time.monotonic() - start_time
        # metrics.timing("email_task_duration", duration)
        loop.close()

# Specific background tasks for different email types
def send_welcome_email_background(to_email: str, user_id: str):
    """Send welcome email in background task."""
    send_email_background("send_welcome_email", to_email=to_email, user_id=user_id)

def send_login_notification_background(to_email: str, user_id: str, ip_address: str, user_agent: str):
    """Send login notification in background task."""
    send_email_background(
        "send_login_notification",
        to_email=to_email,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent
    )

def send_admin_notification_background(subject: str, message: str, admin_email: Optional[str] = None, event_data: Optional[Dict] = None):
    """Send admin notification in background task."""
    send_email_background(
        "send_admin_notification",
        subject=subject,
        message=message,
        admin_email=admin_email,
        event_data=event_data
    )

def send_password_reset_email_background(to_email: str, reset_token: str, user_id: str):
    """Send password reset email in background task."""
    send_email_background(
        "send_password_reset_email",
        to_email=to_email,
        reset_token=reset_token,
        user_id=user_id
    )
