import datetime
from pathlib import Path
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from starlette.middleware.base import BaseHTTPMiddleware
from init_db import init_database
from routers.session import router as session_router
from routers.chat import router as chat_router
from routers.files import router as files_router
from routers.config import router as config_router
from routers.model_stats import router as model_stats_router
from routers.auth import router as auth_router
from startup_validation import db_validation_lifespan

import config
from logging_config import get_logger

# Set up logger
logger = get_logger(__name__)


# Initialize Sentry
sentry_sdk.init(
    # Basic configuration
    dsn=config.settings.SENTRY_DSN,
    environment=config.settings.SENTRY_ENVIRONMENT,
    release=config.settings.SENTRY_RELEASE,
    
    # Performance monitoring
    traces_sample_rate=config.settings.SENTRY_TRACES_SAMPLE_RATE,
    enable_tracing=True,
    
    # Data management
    max_breadcrumbs=config.settings.SENTRY_MAX_BREADCRUMBS,
    send_default_pii=config.settings.SENTRY_SEND_DEFAULT_PII,
    server_name=config.settings.SENTRY_SERVER_NAME,
    
    # Error reporting behavior
    attach_stacktrace=config.settings.SENTRY_ATTACH_STACKTRACE,
    
    # Integrations
    integrations=[
        FastApiIntegration(transaction_style="url"),
    ],
    
    # Additional options
    debug=False,  # Set to True for debugging Sentry issues
    sample_rate=1.0,  # Sample rate for error events (1.0 = 100%)
    before_send=lambda event, hint: event,  # Hook to modify events before sending
    before_breadcrumb=lambda breadcrumb, hint: breadcrumb,  # Hook to modify breadcrumbs
)

class CoroutineCheckMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        # Removed coroutine check to avoid conflicts with streaming/async responses
        return response

@asynccontextmanager
async def database_lifespan(app: FastAPI):
    """Database initialization lifespan"""
    # Initialize the database schema
    await init_database()
    
    # Initialize client pool
    from clients import init_client_pool
    await init_client_pool()
    
    yield
    
    # Cleanup code (if any) goes here
    pass

@db_validation_lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Combined lifespan that runs both db validation and other startup tasks.
    The db_validation_lifespan is used as a decorator to run validation first.
    """
    async with database_lifespan(app):
        yield

# Resolve absolute path to the static directory
STATIC_DIR = Path(__file__).parent / "static"

# Create FastAPI app with lifespan
app = FastAPI(
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    debug=True,
    lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, lock this down
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Cache-Control", "Content-Type", "Authorization", "X-API-Version", "x-ms-error-code", "x-ms-error-message"]
)

# Add coroutine check middleware
app.add_middleware(CoroutineCheckMiddleware)

# Include API routers with non-root prefixes.
app.include_router(session_router, prefix="/api/session")
app.include_router(files_router, prefix="/api/files")
app.include_router(chat_router, prefix="/api")
app.include_router(config_router, prefix="/api")
app.include_router(model_stats_router)  # Already has prefix="/api/model-stats"
app.include_router(auth_router, prefix="/api/auth")

# Mount static files at '/static'
app.mount("/static", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

@app.get("/")
def read_index():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/favicon.ico")
def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico")

@app.get("/apple-touch-icon.png")
async def get_apple_touch_icon():
    return FileResponse(STATIC_DIR / "img/apple-touch-icon.png")

@app.get("/login")
def serve_login():
    return FileResponse(STATIC_DIR / "login.html")

@app.get("/login.html")
def serve_login_html():
    return FileResponse(STATIC_DIR / "login.html")

@app.get("/register")
def serve_register():
    return FileResponse(STATIC_DIR / "register.html")

@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.utcnow(), "version": "1.0.0"}

@app.get("/sentry-test")
async def sentry_test():
    sentry_sdk.capture_message("Sentry test message from FastAPI application")
    raise ValueError("This is a test error to verify Sentry integration")
