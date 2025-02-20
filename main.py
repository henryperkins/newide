# main.py
import datetime
from typing import Dict

# Standard library imports
import os
from pathlib import Path

# Third-party imports
from fastapi import FastAPI, WebSocket
from fastapi.responses import RedirectResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter
from slowapi.util import get_remote_address

# Local imports
from database import init_database
from routers.session import router as session_router
from routers.chat import router as chat_router
from routers.files import router as files_router

app = FastAPI(docs_url="/", redoc_url=None, debug=True)
app.state.limiter = None  # Disable rate limiting for development speed

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add security headers middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = "default-src 'self' https://liveonshuffle.com; script-src 'self' 'sha256-uqAHP7oSlmC974F5gyOP6L4B7iW5WC3Qh6vE9V4ekPg=' 'sha256-RIrTk/seH7EQbSSoo6rWBqdTlxBImAyqdCDIDMHC22s='; style-src 'self' 'unsafe-hashes' 'sha256-biLFinpqYMtWHmXfkA1BPeCY0/fNt46SAZ+BBk5YUog='"
    return response

app.add_middleware(GZipMiddleware, minimum_size=1000)

# Mount static files with specific MIME types
app.mount("/static", StaticFiles(
    directory="/home/azureuser/newide/static",
    check_dir=True,
    html=False
), name="static")

app.include_router(session_router)
app.include_router(files_router)
app.include_router(chat_router)

@app.on_event("startup")
async def startup():
    await init_database()
    from clients import init_client_pool
    await init_client_pool()

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")

@app.get("/favicon.ico")
async def favicon():
    return FileResponse("static/favicon.ico")

@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.utcnow()}
