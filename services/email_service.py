"""
Email service for the application, handling all email functionality through SendGrid.
"""
import os
from typing import Optional, List, Dict, Any
import sentry_sdk

# Import SendGrid library
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Email, To, Content, Personalization

# Import application configuration
import config
from logging_config import get_logger

# Import the template system
from services.email_templates import (
    get_welcome_email, 
    get_login_notification_email, 
    get_admin_notification_email,
    get_password_reset_email
)

# Set up logger
logger = get_logger(__name__)

# Set up SendGrid configuration
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "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")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "noreply@azureopenai-chat.com")
DEFAULT_FROM_NAME = os.getenv("DEFAULT_FROM_NAME", "Azure OpenAI Chat")


class EmailService:
    """Email service for sending emails through SendGrid."""
    
    def __init__(self):
        """Initialize the email service."""
        self.api_key = SENDGRID_API_KEY
        self.from_email = DEFAULT_FROM_EMAIL
        self.from_name = DEFAULT_FROM_NAME
        self.client = None

    def _get_client(self) -> SendGridAPIClient:
        """Get or create a SendGrid client."""
        if not self.client:
            self.client = SendGridAPIClient(self.api_key)
        return self.client

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None,
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
        template_id: Optional[str] = None,
        template_data: Optional[Dict[str, Any]] = None,
        categories: Optional[List[str]] = None,
    ) -> bool:
        """
        Send an email using SendGrid.
        
        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML content of the email
            text_content: Plain text content of the email (optional)
            from_email: Sender email address (optional, defaults to DEFAULT_FROM_EMAIL)
            from_name: Sender name (optional, defaults to DEFAULT_FROM_NAME)
            template_id: SendGrid template ID (optional)
            template_data: Data to populate template (optional)
            categories: Categories for email tracking (optional)
            
        Returns:
            bool: True if email was sent successfully, False otherwise
        """
        try:
            # Create a SendGrid Mail object
            mail = Mail(from_email=None, to_emails=None, subject=None, plain_text_content=None, html_content=None)
            
            # Set from email
            mail.from_email = Email(
                email=from_email or self.from_email,
                name=from_name or self.from_name
            )
            
            # Set recipient
            mail.to = [To(email=to_email)]
            
            # Set subject
            mail.subject = subject
            
            # Initialize content as empty list if not set yet
            mail.content = []
            
            # Set content
            if html_content:
                mail.content.append(Content("text/html", html_content))
                
            if text_content:
                mail.content.append(Content("text/plain", text_content))
            
            # Set template if provided
            if template_id:
                mail.template_id = template_id
                
                # Add template data if provided
                if template_data:
                    personalization = Personalization()
                    personalization.add_to(To(to_email))
                    
                    # Initialize dynamic_template_data as a dictionary
                    personalization.dynamic_template_data = {}
                    
                    # Populate template data
                    for key, value in template_data.items():
                        personalization.dynamic_template_data[key] = value
                        
                    mail.add_personalization(personalization)
            
            # Add categories if provided
            if categories:
                for category in categories:
                    mail.add_category(category)
            
            # Send the email
            response = self._get_client().send(mail)
            
            # Log success
            logger.info(
                f"Email sent successfully to {to_email}",
                extra={"subject": subject, "status_code": response.status_code}
            )
            
            return response.status_code in (200, 201, 202)
            
        except Exception as e:
            # Log error and capture in Sentry
            logger.error(
                f"Failed to send email to {to_email}: {str(e)}",
                extra={"subject": subject}
            )
            sentry_sdk.capture_exception(e)
            return False

    async def send_welcome_email(self, to_email: str, user_id: str) -> bool:
        """
        Send a welcome email to a newly registered user.
        
        Args:
            to_email: User's email address
            user_id: User's ID
            
        Returns:
            bool: True if email was sent successfully, False otherwise
        """
        subject = "Welcome to Azure OpenAI Chat!"
        
        # Get template content from the template system
        html_content, text_content = get_welcome_email(user_id)
        
        return await self.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            categories=["welcome", "registration"]
        )

    async def send_login_notification(self, to_email: str, user_id: str, ip_address: str, user_agent: str) -> bool:
        """
        Send a login notification email to a user.
        
        Args:
            to_email: User's email address
            user_id: User's ID
            ip_address: IP address of the login attempt
            user_agent: User agent of the login attempt
            
        Returns:
            bool: True if email was sent successfully, False otherwise
        """
        subject = "New Login to Your Azure OpenAI Chat Account"
        
        # Get formatted timestamp
        timestamp = get_formatted_time()
        
        # Parse user agent
        device = parse_user_agent(user_agent)
        
        # Get template content from the template system
        html_content, text_content = get_login_notification_email(
            timestamp=timestamp,
            ip_address=ip_address,
            device=device
        )
        
        return await self.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            categories=["security", "login"]
        )

    async def send_admin_notification(
        self, 
        subject: str, 
        message: str, 
        admin_email: Optional[str] = None,
        event_data: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Send a notification to the system administrator.
        
        Args:
            subject: Email subject
            message: Message content
            admin_email: Admin email address (optional, defaults to config.settings.ADMIN_EMAIL)
            event_data: Additional event data to include in the email (optional)
            
        Returns:
            bool: True if email was sent successfully, False otherwise
        """
        admin_email = admin_email or config.settings.ADMIN_EMAIL
        
        if not admin_email:
            logger.warning("Admin email not configured, skipping notification")
            return False
        
        # Get template content from the template system
        html_content, text_content = get_admin_notification_email(
            subject=subject,
            message=message,
            event_data=event_data
        )
        
        return await self.send_email(
            to_email=admin_email,
            subject=f"ADMIN ALERT: {subject}",
            html_content=html_content,
            text_content=text_content,
            categories=["admin", "alert"]
        )

    async def send_password_reset_email(self, to_email: str, reset_token: str, user_id: str) -> bool:
        """
        Send a password reset email to a user.
        
        Args:
            to_email: User's email address
            reset_token: Password reset token
            user_id: User's ID
            
        Returns:
            bool: True if email was sent successfully, False otherwise
        """
        subject = "Reset Your Azure OpenAI Chat Password"
        
        # Generate password reset link
        reset_link = f"{get_base_url()}/reset-password?token={reset_token}&user_id={user_id}"
        
        # Get template content from the template system
        html_content, text_content = get_password_reset_email(reset_link=reset_link)
        
        return await self.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            categories=["password", "reset"]
        )


# Helper functions
def get_formatted_time() -> str:
    """Get the current time formatted for display in emails."""
    from datetime import datetime
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")


def parse_user_agent(user_agent: str) -> str:
    """
    Parse the user agent string to get a more readable device description.
    This is a simple implementation - in production, consider using a dedicated user-agent parsing library.
    """
    if not user_agent:
        return "Unknown device"
        
    device = "Unknown device"
    
    # Check for common mobile devices
    if "iPhone" in user_agent:
        device = "iPhone"
    elif "iPad" in user_agent:
        device = "iPad"
    elif "Android" in user_agent:
        device = "Android device"
    # Check for common browsers
    elif "Chrome" in user_agent and "Edge" not in user_agent:
        device = "Computer (Chrome)"
    elif "Firefox" in user_agent:
        device = "Computer (Firefox)"
    elif "Safari" in user_agent and "Chrome" not in user_agent:
        device = "Computer (Safari)"
    elif "Edge" in user_agent:
        device = "Computer (Edge)"
    
    return device


def get_base_url() -> str:
    """Get the base URL for the application."""
    base_url = os.getenv("BASE_URL")
    if not base_url:
        # Fallback to localhost in development
        base_url = "http://localhost:8000"
    return base_url


# Create a singleton instance
email_service = EmailService()
