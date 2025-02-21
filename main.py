# main.py
import datetime
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import init_database
from routers.session import router as session_router
from routers.chat import router as chat_router
from routers.files import router as files_router

# Get absolute path to static directory
STATIC_DIR = Path(__file__).parent / "static"

# Create FastAPI app with minimal config
app = FastAPI(
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    debug=True
)

# Add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Mount static files first
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Root route
@app.get("/", response_class=FileResponse)
def root():
    index_path = STATIC_DIR / "index.html"
    return FileResponse(
        path=str(index_path),
        media_type="text/html",
        headers={"Content-Type": "text/html; charset=utf-8"}
    )

@app.get("/favicon.ico")
def favicon():
    favicon_path = STATIC_DIR / "favicon.ico"
    return FileResponse(str(favicon_path))

# Include API routers with prefixes
app.include_router(session_router, prefix="/api/session")
app.include_router(files_router, prefix="/api/files")
app.include_router(chat_router, prefix="/api/chat")

@app.on_event("startup")
async def startup():
    await init_database()
    from clients import init_client_pool
    await init_client_pool()

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.datetime.utcnow(),
        "version": "1.0.0"
    }
