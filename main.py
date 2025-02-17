from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket
from sqlalchemy.ext.asyncio import (
    create_async_engine, 
    AsyncSession
)
from sqlalchemy.orm import (
    sessionmaker, 
    declarative_base
)
from sqlalchemy import (
    text,
    Column,
    UUID,
    String,
    DateTime,
    Text,
    ForeignKey,
    Integer,
    BigInteger
)
from fastapi.websockets import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import time
from pydantic import BaseModel
from typing import Optional, List, Dict
from enum import Enum
import os
import uuid
import datetime

import config
from openai import AzureOpenAI


app = FastAPI()


@app.on_event("startup")
async def init_db():
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                size BIGINT NOT NULL,
                upload_time TIMESTAMPTZ DEFAULT NOW()
            );
        """))


app.mount("/static", StaticFiles(directory="static"), name="static")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base = declarative_base()

# SQLAlchemy ORM Models
class Session(Base):
    __tablename__ = "sessions"
    id = Column(UUID, primary_key=True)
    created_at = Column(
        DateTime(timezone=True), 
        server_default=text("NOW()")
    )
    last_activity = Column(
        DateTime(timezone=True), 
        server_default=text("NOW()")
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(
        UUID, 
        ForeignKey("sessions.id"), 
        nullable=False
    )
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    timestamp = Column(
        DateTime(timezone=True), 
        server_default=text("NOW()")
    )


class UploadedFile(Base):
    __tablename__ = "uploaded_files"
    id = Column(UUID, primary_key=True)
    session_id = Column(UUID, ForeignKey("sessions.id"), nullable=False)
    filename = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    size = Column(BigInteger, nullable=False)
    upload_time = Column(
        DateTime(timezone=True), 
        server_default=text("NOW()")
    )

# Initialize Azure OpenAI client
client = AzureOpenAI(
    api_key=str(config.AZURE_OPENAI_API_KEY),
    api_version="2025-01-01-preview",
    azure_endpoint=str(config.AZURE_OPENAI_ENDPOINT)
)

# Configure PostgreSQL
engine = create_async_engine(
    config.POSTGRES_URL,  # From .env via config.py
    pool_size=20,
    max_overflow=10,
    pool_recycle=3600,
    connect_args={"ssl": "prefer"}  # Add SSL preference
)
AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

# In-memory storage for conversations and file contents
conversations: Dict[str, List[Dict]] = {}


class FileMetadata(BaseModel):
    filename: str
    content: str
    size: int
    upload_time: str
    char_count: int
    estimated_tokens: int  # rough estimate based on characters/4


# session_id -> {file_id -> metadata}
file_store: Dict[str, Dict[str, FileMetadata]] = {}


class ReasoningEffort(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


def validate_reasoning_effort(value: Optional[ReasoningEffort]) -> str:
    # Return enum value if provided, else default to "medium"
    return value.value if value else "medium"


class ChatMessage(BaseModel):
    message: str
    session_id: str
    developer_config: Optional[str] = None
    reasoning_effort: Optional[ReasoningEffort] = None


@app.get("/")
async def serve_root():
    # Construct the absolute path to index.html
    base_path = os.path.dirname(__file__)
    index_file = os.path.join(base_path, "static", "index.html")
    if not os.path.exists(index_file):
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(index_file)


@app.post("/chat")
async def chat(chat_message: ChatMessage):
    session_id = chat_message.session_id

    # Initialize conversation history if needed
    if session_id not in conversations:
        conversations[session_id] = []

    # Prepare messages for the API call
    messages = []

    # Add developer message if provided
    if chat_message.developer_config:
        # Prefix with "Formatting re-enabled" for markdown
        formatted_content = chat_message.developer_config
        has_code = ("```" in chat_message.message
                    or "code" in chat_message.message.lower())
        if has_code:
            formatted_content = (
                "Formatting re-enabled - code output should be wrapped in "
                "markdown.\n" + formatted_content
            )
        else:
            formatted_content = (
                "Formatting re-enabled\n" + formatted_content
            )

        messages.append({
            "role": "developer",
            "content": formatted_content
        })

    # Add conversation history
    messages.extend(conversations[session_id])

    # Add user message
    messages.append({"role": "user", "content": chat_message.message})

    using_file_context = False
    if session_id in file_store:
        for file_id, metadata in file_store[session_id].items():
            messages[-1]["content"] += (
                f"\n\nContext from file ({metadata.filename}):\n"
                f"{metadata.content}"
            )
            using_file_context = True

    try:
        try:
            # o1 requirements:
            # - max_completion_tokens required
            # - no streaming, top_p, etc.
            # - reasoning_effort optional
            params = {
                "model": str(config.AZURE_OPENAI_DEPLOYMENT_NAME),
                "messages": messages,
                "max_completion_tokens": 100000
            }

            # Only add reason. effort for o1 / o3-mini models
            model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
            is_reasoning = (any(m in model_name for m in ["o1-", "o3-"])
                            and "preview" not in model_name)
            if is_reasoning:
                params["reasoning_effort"] = validate_reasoning_effort(
                    chat_message.reasoning_effort
                )

            response = client.chat.completions.create(**params)
        except Exception as e:
            print(f"Azure OpenAI API Error: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Error communicating with Azure OpenAI service"
            )

        assistant_msg = response.choices[0].message.content

        # Update conversation
        conversations[session_id].append({
            "role": "user",
            "content": chat_message.message
        })
        conversations[session_id].append({
            "role": "assistant",
            "content": assistant_msg
        })

        return {
            "response": assistant_msg,
            "using_file_context": using_file_context,
            "usage": {
                "prompt_tokens": (
                    response.usage.prompt_tokens if response.usage else 0
                ),
                "completion_tokens": (
                    response.usage.completion_tokens
                    if response.usage else 0
                ),
                "total_tokens": (
                    response.usage.total_tokens if response.usage else 0
                )
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    session_id: str = Form(...),
):
    if not session_id:
        raise HTTPException(status_code=400, detail="Session ID is required")

    if (session_id not in file_store and
       session_id not in conversations):
        raise HTTPException(
            status_code=400,
            detail="Invalid session ID. Please refresh."
        )

    try:
        contents = await file.read()
        try:
            file_text = contents.decode('utf-8')
            # Truncate if needed
            if len(file_text) > 100000:
                file_text = (
                    file_text[:100000] +
                    "\n[Content truncated due to length]"
                )

            file_id = str(uuid.uuid4())
            file_meta = FileMetadata(
                filename=file.filename or "unnamed_file.txt",
                content=file_text,
                size=len(contents),
                upload_time=datetime.datetime.now().isoformat(),
                char_count=len(file_text),
                estimated_tokens=len(file_text) // 4
            )
            if session_id not in file_store:
                file_store[session_id] = {}
            file_store[session_id][file_id] = file_meta

            return {
                "message": "File uploaded successfully",
                "file_id": file_id,
                "metadata": {
                    "filename": file.filename,
                    "size": len(contents),
                    "upload_time": file_meta.upload_time,
                    "char_count": len(file_text),
                    "estimated_tokens": file_meta.estimated_tokens
                }
            }
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="File must be valid UTF-8 text"
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing file: {str(e)}"
        )


@app.get("/files/{session_id}")
async def get_session_files(session_id: str):
    """Get metadata for all files in a session"""
    if session_id not in file_store:
        return {"files": []}

    files = []
    for file_id, meta in file_store[session_id].items():
        files.append({
            "file_id": file_id,
            "filename": meta.filename,
            "size": meta.size,
            "upload_time": meta.upload_time,
            "char_count": meta.char_count,
            "estimated_tokens": meta.estimated_tokens
        })

    return {"files": files}


@app.delete("/files/{session_id}/{file_id}")
async def delete_file(session_id: str, file_id: str):
    """Delete a file from the session"""
    if session_id not in file_store or file_id not in file_store[session_id]:
        raise HTTPException(status_code=404, detail="File not found")

    del file_store[session_id][file_id]
    return {"message": "File deleted successfully"}


typing_status: Dict[str, Dict[str, float]] = {}


@app.websocket("/ws/typing/{session_id}")
async def websocket_typing(websocket: WebSocket, session_id: str):
    await websocket.accept()
    user_id = str(uuid.uuid4())

    try:
        while True:
            await websocket.receive_text()
            typing_status.setdefault(session_id, {})[user_id] = time.time()

            active_typers = [
                uid for uid, t in typing_status.get(session_id, {}).items()
                if time.time() - t < 2
            ]
            await websocket.send_json({"typing_users": active_typers})

    except WebSocketDisconnect:
        del typing_status[session_id][user_id]


@app.post("/new_session")
async def new_session():
    session_id = str(uuid.uuid4())
    conversations[session_id] = []
    return {"session_id": session_id}
