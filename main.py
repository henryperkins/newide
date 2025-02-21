import datetime
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from database import init_database
from routers.session import router as session_router
from routers.chat import router as chat_router
from routers.files import router as files_router

# Resolve absolute path to the static directory
STATIC_DIR = Path(__file__).resolve().parent / "static"

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

# Include API routers with non-root prefixes.
app.include_router(session_router, prefix="/api/session")
app.include_router(files_router, prefix="/api/files")
app.include_router(chat_router, prefix="/api/chat")

# Mount static files at '/static' instead
app.mount("/static", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

# Serve the index file on the root path
@app.get("/")
def read_index():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/favicon.ico")
def favicon():
    favicon_path = STATIC_DIR / "favicon.ico"
    return FileResponse(str(favicon_path))

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