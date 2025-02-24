# main.py
import datetime
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi import Depends  # Import Depends

from database import init_database
from routers.session import router as session_router
from routers.chat import router as chat_router
from routers.files import router as files_router
from routers.config import router as config_router
from routers.model_stats import router as model_stats_router

import config
from services.config_service import ConfigService  # Import ConfigService


def lifespan(app: FastAPI):
    print(
        f"[DEBUG] AZURE_OPENAI_DEPLOYMENT_NAME from config: {config.settings.AZURE_OPENAI_DEPLOYMENT_NAME}"
    )

    async def startup_event():
        await init_database()
        from clients import init_client_pool

        # Pass the ConfigService dependency to init_client_pool
        # await init_client_pool(config_service=ConfigService(db=None))  # Corrected ConfigService instantiation - removed to avoid double init.
        pass  # The init will be done in get_client_pool() which depends on ConfigService

    yield


# Resolve absolute path to the static directory
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(
    docs_url=None, redoc_url=None, openapi_url=None, debug=True, lifespan=lifespan
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, lock this down
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type", "Authorization", "api-key", "X-API-Version", "x-model-type"],
    expose_headers=[
        "Content-Type",
        "Authorization",
        "X-API-Version",
        "x-ms-error-code",
        "x-ms-error-message",
    ],
)

# Include API routers with non-root prefixes.
app.include_router(session_router, prefix="/api/session")
app.include_router(files_router, prefix="/api/files")
app.include_router(chat_router, prefix="/api")
app.include_router(config_router, prefix="/api")
app.include_router(model_stats_router)  # Already has prefix="/api/model-stats"

# Mount static files at '/static' instead
app.mount("/static", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


# Serve the index file on the root path
@app.get("/")
def read_index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.ico")
def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico")  # Serve actual favicon


@app.get("/apple-touch-icon.png")
async def get_apple_touch_icon():
    return FileResponse(STATIC_DIR / "img/apple-touch-icon.png")


@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.utcnow(), "version": "1.0.0"}
