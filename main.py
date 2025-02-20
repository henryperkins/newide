# main.py
import datetime
from typing import Dict

# Standard library imports
import os
from pathlib import Path

# Third-party imports
from fastapi import FastAPI, WebSocket
from fastapi.middleware.security import SecurityHeadersMiddleware
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

app = FastAPI()
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    SecurityHeadersMiddleware,
    content_security_policy="default-src 'self' https://liveonshuffle.com; style-src 'self' 'unsafe-inline' https://liveonshuffle.com;",
    permissions_policy=""
)

# Mount static files with specific MIME types
app.mount("/static", StaticFiles(
    directory="static",
    check_dir=True,
    html=False
), name="static")

app.include_router(session_router)
app.include_router(files_router)
app.include_router(chat_router)

@app.on_event("startup")
async def startup():
    await init_database()

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")

@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.utcnow()}
