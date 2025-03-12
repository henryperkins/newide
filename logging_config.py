# logging_config.py
import logging
from logging.handlers import RotatingFileHandler
import os
import sys
import json
from typing import Dict, Any

# Import Sentry integration only when available
try:
    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration
    SENTRY_AVAILABLE = True
except ImportError:
    SENTRY_AVAILABLE = False
    sentry_sdk = None  # Define as None for type checking
    LoggingIntegration = None

# Create logs directory if it doesn't exist
if not os.path.exists("logs"):
    os.makedirs("logs")

# Structured logging formatter
class JsonLogFormatter(logging.Formatter):
    """JSON formatter for structured logging with Sentry integration."""
    
    def format(self, record):
        log_record: Dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
            "process_id": record.process,
            "thread_id": record.thread,
        }
        
        # Include exception information if available
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)
            
            # Send exception to Sentry if available
            if SENTRY_AVAILABLE and sentry_sdk is not None:
                sentry_sdk.capture_exception(record.exc_info[1])
        
        # Add extra fields from record safely
        extra = getattr(record, "extra", None)
        if extra:
            log_record.update(extra)
            
        # Add trace context if available in the record
        trace_id = getattr(record, "trace_id", None)
        if trace_id:
            log_record["trace_id"] = trace_id
            
        span_id = getattr(record, "span_id", None)
        if span_id:
            log_record["span_id"] = span_id
            
        # Add transaction name if available
        transaction_name = getattr(record, "transaction", None)
        if transaction_name:
            log_record["transaction"] = transaction_name
        
        # Add to Sentry breadcrumbs if available
        if SENTRY_AVAILABLE and sentry_sdk is not None:
            # Always add as breadcrumb, but adjust level based on severity
            breadcrumb_level = record.levelname.lower()
            # Normalize level names to match Sentry's expectations
            if breadcrumb_level == "critical":
                breadcrumb_level = "fatal"
            elif breadcrumb_level not in ("debug", "info", "warning", "error", "fatal"):
                breadcrumb_level = "info"
                
            # Extract relevant data for the breadcrumb
            breadcrumb_data = {
                "logger": record.name,
                "module": record.module,
                "line": record.lineno,
            }
            
            # Add extra data if available
            if extra:
                # Filter out sensitive or redundant information
                safe_extra = {k: v for k, v in extra.items() 
                             if not k.startswith("_") and k not in ("password", "token", "secret")}
                breadcrumb_data.update(safe_extra)
            
            sentry_sdk.add_breadcrumb(
                category="logging",
                message=record.getMessage(),
                level=breadcrumb_level,
                data=breadcrumb_data
            )
            
        return json.dumps(log_record)

# Standard text formatter with more detail
class DetailedFormatter(logging.Formatter):
    """Detailed text formatter for console and file logs."""
    
    def __init__(self, include_trace=False):
        super().__init__()
        self.include_trace = include_trace
        
    def format(self, record):
        format_str = "%(asctime)s - %(levelname)s - [%(name)s] - %(message)s"
        
        if self.include_trace and hasattr(record, "trace_id"):
            format_str = "%(asctime)s - %(levelname)s - [%(name)s] - [trace:%(trace_id)s] - %(message)s"
            
        formatter = logging.Formatter(format_str)
        return formatter.format(record)

# Create a structured logger class for consistent logging with context
class StructuredLogger(logging.Logger):
    """Enhanced logger with support for structured logging and context."""
    
    def __init__(self, name, level=logging.NOTSET):
        super().__init__(name, level)
        self.context = {}
        
    def with_context(self, **context):
        """Create a new logger with additional context."""
        logger = logging.getLogger(self.name)
        if isinstance(logger, StructuredLogger):
            logger.context.update(context)
        return logger
        
    def _log(self, level, msg, args, exc_info=None, extra=None, stack_info=False, stacklevel=1, **kwargs):
        """Override _log to include context in extra."""
        if extra is None:
            extra = {}
        
        # Add logger context to extra
        if self.context:
            extra.update(self.context)
            
        # Get trace context from kwargs
        trace_id = kwargs.get('trace_id')
        span_id = kwargs.get('span_id')
        
        # Add trace context if available
        if trace_id:
            extra["trace_id"] = trace_id
        if span_id:
            extra["span_id"] = span_id
            
        # Get current Sentry trace context, if available
        if SENTRY_AVAILABLE and sentry_sdk is not None:
            current_span = sentry_sdk.Hub.current.scope.span
            if current_span and not trace_id:
                extra["trace_id"] = current_span.trace_id
                extra["span_id"] = current_span.span_id
        
        # Store extra fields in the record for the formatter
        if extra:
            record_extra = {"extra": extra}
            super()._log(level, msg, args, exc_info, record_extra, stack_info, stacklevel)
        else:
            super()._log(level, msg, args, exc_info, extra, stack_info, stacklevel)


# Register the custom logger class
logging.setLoggerClass(StructuredLogger)


# Configure basic logging
def configure_basic_logging():
    """Configure basic console and file logging."""
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(DetailedFormatter(include_trace=True))
    console_handler.setLevel(logging.INFO)
    root_logger.addHandler(console_handler)
    
    # File handler
    file_handler = RotatingFileHandler("logs/app.log", maxBytes=10_000_000, backupCount=5)
    file_handler.setFormatter(JsonLogFormatter())
    file_handler.setLevel(logging.INFO)
    root_logger.addHandler(file_handler)
    
    # Error file handler - separate file for errors and above
    error_handler = RotatingFileHandler("logs/error.log", maxBytes=10_000_000, backupCount=5)
    error_handler.setFormatter(JsonLogFormatter())
    error_handler.setLevel(logging.ERROR)
    root_logger.addHandler(error_handler)
    
    # Configure Sentry logging integration if available
    if SENTRY_AVAILABLE and sentry_sdk is not None and LoggingIntegration is not None:
        # This will be used if Sentry is initialized elsewhere
        # It configures how logging events are sent to Sentry
        sentry_logging = LoggingIntegration(
            level=logging.INFO,        # Capture info and above as breadcrumbs
            event_level=logging.ERROR  # Send errors and above as events
        )
        
        # Store the integration for later use during Sentry initialization
        global sentry_logging_integration
        sentry_logging_integration = sentry_logging


# Configure input/response specific loggers
input_logger = logging.getLogger("input_logger")
input_logger.setLevel(logging.INFO)
input_handler = RotatingFileHandler("logs/input.log", maxBytes=5_000_000, backupCount=3)
input_handler.setFormatter(JsonLogFormatter())
input_logger.addHandler(input_handler)
input_logger.propagate = False

response_logger = logging.getLogger("response_logger")
response_logger.setLevel(logging.INFO)
response_handler = RotatingFileHandler("logs/response.log", maxBytes=5_000_000, backupCount=3)
response_handler.setFormatter(JsonLogFormatter())
response_logger.addHandler(response_handler)
response_logger.propagate = False

# Create main logger for this module
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Global variable to store the Sentry logging integration
sentry_logging_integration = None

# Helper function to get a logger with Sentry trace context
def get_logger(name: str, **context) -> logging.Logger:
    """
    Get a logger with optional context and automatic Sentry trace context.
    
    Args:
        name: Logger name
        context: Additional context to include in log records
        
    Returns:
        Logger instance with context
    """
    logger = logging.getLogger(name)
    
    if isinstance(logger, StructuredLogger) and context:
        logger = logger.with_context(**context)
        
    return logger

def configure_sentry(dsn: str, environment: str, release: str, 
                    traces_sample_rate: float = 0.1,
                    profiles_sample_rate: float = 0.0,
                    **options):
    """
    Configure Sentry SDK with proper logging integration.
    
    Args:
        dsn: Sentry DSN
        environment: Environment name (e.g., "production", "staging")
        release: Release version
        traces_sample_rate: Sample rate for performance monitoring (0.0 to 1.0)
        profiles_sample_rate: Sample rate for profiling (0.0 to 1.0)
        **options: Additional Sentry options
    """
    if not SENTRY_AVAILABLE or sentry_sdk is None:
        logger.warning("Sentry SDK not available. Skipping Sentry configuration.")
        return
    
    # Default integrations to use
    integrations = []
    
    # Add logging integration if available
    if sentry_logging_integration is not None:
        integrations.append(sentry_logging_integration)
    
    # Initialize Sentry with our configuration
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate,
        profiles_sample_rate=profiles_sample_rate,
        integrations=integrations,
        
        # Set reasonable defaults for the application
        max_breadcrumbs=options.get("max_breadcrumbs", 100),
        send_default_pii=options.get("send_default_pii", False),
        attach_stacktrace=options.get("attach_stacktrace", True),
        
        # Set reasonable defaults for the application
        
        # Configure event sampling
        sample_rate=options.get("sample_rate", 1.0),
        
        # Configure before_send hook if provided
        before_send=options.get("before_send", None),
        
        # Configure before_breadcrumb hook if provided
        before_breadcrumb=options.get("before_breadcrumb", None),
    )
    
    # Set default tags after initialization
    default_tags = options.get("tags", {
        "service": "newide",
        "logger": "python"
    })
    
    for tag_name, tag_value in default_tags.items():
        sentry_sdk.set_tag(tag_name, tag_value)
    
    logger.info(f"Sentry initialized: environment={environment}, release={release}")


# Initialize basic logging
configure_basic_logging()
