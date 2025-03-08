# logging_config.py
import logging
from logging.handlers import RotatingFileHandler
import os
import sys
import json
from typing import Dict, Any, Optional

# Import Sentry integration only when available
try:
    import sentry_sdk
    SENTRY_AVAILABLE = True
except ImportError:
    SENTRY_AVAILABLE = False
    sentry_sdk = None  # Define as None for type checking

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
        
        # Add to Sentry breadcrumbs if available and level is warning or higher
        if SENTRY_AVAILABLE and sentry_sdk is not None and record.levelno >= logging.WARNING:
            sentry_sdk.add_breadcrumb(
                category=record.name,
                message=record.getMessage(),
                level=record.levelname.lower(),
                data=getattr(record, "extra", {})
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

# Initialize basic logging
configure_basic_logging()