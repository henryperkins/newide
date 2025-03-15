"""
Simple template system for email templates.
This module contains templates for various emails and provides functions to render them.
"""

# Template placeholders use {{variable_name}} format
# HTML templates
TEMPLATES_HTML = {
    "welcome": """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0078D4;">Welcome to Azure OpenAI Chat!</h1>
        <p>Thank you for registering with us. Your account has been successfully created.</p>
        <p>You now have access to Azure OpenAI models including DeepSeek-R1 and O-series models.</p>
        <p>Your user ID is: <strong>{{user_id}}</strong></p>
        <div style="margin-top: 30px; padding: 20px; background-color: #f7f7f7; border-radius: 5px;">
            <h2 style="color: #0078D4; margin-top: 0;">Getting Started</h2>
            <p>To get started:</p>
            <ol>
                <li>Log in to your account</li>
                <li>Select a model from the dropdown</li>
                <li>Start chatting with the AI</li>
            </ol>
        </div>
        <p style="margin-top: 30px;">If you have any questions, please don't hesitate to contact our support team.</p>
        <p>Best regards,<br>The Azure OpenAI Chat Team</p>
    </div>
    """,
    
    "login_notification": """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0078D4;">New Account Login</h1>
        <p>We detected a new login to your Azure OpenAI Chat account.</p>
        <div style="margin-top: 20px; padding: 15px; background-color: #f7f7f7; border-radius: 5px;">
            <h3 style="margin-top: 0;">Login Details:</h3>
            <ul style="list-style-type: none; padding-left: 0;">
                <li><strong>Time:</strong> {{timestamp}}</li>
                <li><strong>IP Address:</strong> {{ip_address}}</li>
                <li><strong>Device:</strong> {{device}}</li>
            </ul>
        </div>
        <p style="margin-top: 30px;">If this was you, you can ignore this email.</p>
        <p>If you didn't log in recently, please secure your account by changing your password immediately.</p>
        <p>Best regards,<br>The Azure OpenAI Chat Security Team</p>
    </div>
    """,
    
    "admin_notification": """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #FF0000;">ADMIN ALERT: {{subject}}</h1>
        <div style="padding: 15px; background-color: #f7f7f7; border-radius: 5px; margin: 20px 0;">
            <p>{{message}}</p>
        </div>
        {{event_data_html}}
        <p style="margin-top: 30px;">This is an automated message from the system.</p>
    </div>
    """,
    
    "password_reset": """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0078D4;">Password Reset Request</h1>
        <p>We received a request to reset your password for your Azure OpenAI Chat account.</p>
        <p>Please click the button below to reset your password. This link is valid for 1 hour.</p>
        <div style="text-align: center; margin: 30px 0;">
            <a href="{{reset_link}}" style="background-color: #0078D4; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset Password</a>
        </div>
        <p>If you didn't request this password reset, you can safely ignore this email. Your account security has not been compromised.</p>
        <p>Best regards,<br>The Azure OpenAI Chat Team</p>
    </div>
    """
}

# Plain text templates
TEMPLATES_TEXT = {
    "welcome": """
    Welcome to Azure OpenAI Chat!
    
    Thank you for registering with us. Your account has been successfully created.
    You now have access to Azure OpenAI models including DeepSeek-R1 and O-series models.
    
    Your user ID is: {{user_id}}
    
    Getting Started:
    1. Log in to your account
    2. Select a model from the dropdown
    3. Start chatting with the AI
    
    If you have any questions, please don't hesitate to contact our support team.
    
    Best regards,
    The Azure OpenAI Chat Team
    """,
    
    "login_notification": """
    New Account Login
    
    We detected a new login to your Azure OpenAI Chat account.
    
    Login Details:
    - Time: {{timestamp}}
    - IP Address: {{ip_address}}
    - Device: {{device}}
    
    If this was you, you can ignore this email.
    
    If you didn't log in recently, please secure your account by changing your password immediately.
    
    Best regards,
    The Azure OpenAI Chat Security Team
    """,
    
    "admin_notification": """
    ADMIN ALERT: {{subject}}
    
    {{message}}
    
    {{event_data_text}}
    
    This is an automated message from the system.
    """,
    
    "password_reset": """
    Password Reset Request
    
    We received a request to reset your password for your Azure OpenAI Chat account.
    
    Please click the link below to reset your password. This link is valid for 1 hour.
    
    {{reset_link}}
    
    If you didn't request this password reset, you can safely ignore this email. Your account security has not been compromised.
    
    Best regards,
    The Azure OpenAI Chat Team
    """
}


def render_template(template_name, template_type, **kwargs):
    """
    Render a template with the given variables.
    
    Args:
        template_name: Name of the template to render
        template_type: 'html' or 'text'
        **kwargs: Variables to insert into the template
        
    Returns:
        str: The rendered template
    """
    # Get the template based on type
    templates = TEMPLATES_HTML if template_type == 'html' else TEMPLATES_TEXT
    
    # Get the template content
    template = templates.get(template_name)
    if not template:
        raise ValueError(f"Template '{template_name}' not found for type '{template_type}'")
    
    # Special handling for event data in admin notification
    if template_name == 'admin_notification' and 'event_data' in kwargs:
        event_data = kwargs.pop('event_data', {})
        
        if template_type == 'html':
            # Format event data as HTML table
            event_data_html = """
            <div style="margin-top: 20px;">
                <h3>Event Details:</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tbody>
            """
            
            for key, value in event_data.items():
                event_data_html += f"""
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">{key}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">{value}</td>
                </tr>
                """
                
            event_data_html += """
                    </tbody>
                </table>
            </div>
            """
            
            kwargs['event_data_html'] = event_data_html
        else:
            # Format event data as plain text
            event_data_text = "Event Details:\n"
            for key, value in event_data.items():
                event_data_text += f"{key}: {value}\n"
            
            kwargs['event_data_text'] = event_data_text
    
    # Replace all placeholders with values
    rendered = template
    for key, value in kwargs.items():
        placeholder = f"{{{{{key}}}}}"
        rendered = rendered.replace(placeholder, str(value))
    
    return rendered


def get_welcome_email(user_id):
    """Get welcome email content."""
    html = render_template('welcome', 'html', user_id=user_id)
    text = render_template('welcome', 'text', user_id=user_id)
    return html, text


def get_login_notification_email(timestamp, ip_address, device):
    """Get login notification email content."""
    html = render_template('login_notification', 'html', 
                          timestamp=timestamp, 
                          ip_address=ip_address,
                          device=device)
    text = render_template('login_notification', 'text', 
                          timestamp=timestamp, 
                          ip_address=ip_address,
                          device=device)
    return html, text


def get_admin_notification_email(subject, message, event_data=None):
    """Get admin notification email content."""
    html = render_template('admin_notification', 'html', 
                          subject=subject, 
                          message=message,
                          event_data=event_data or {})
    text = render_template('admin_notification', 'text', 
                          subject=subject, 
                          message=message,
                          event_data=event_data or {})
    return html, text


def get_password_reset_email(reset_link):
    """Get password reset email content."""
    html = render_template('password_reset', 'html', reset_link=reset_link)
    text = render_template('password_reset', 'text', reset_link=reset_link)
    return html, text