import logging
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket, Request
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware 
from slowapi import Limiter
from slowapi.util import get_remote_address
from time import perf_counter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

import os

# Ensure the logs directory exists
if not os.path.exists("logs"):
    os.makedirs("logs")

# Configure a dedicated logger for user input
input_logger = logging.getLogger("input_logger")
input_logger.setLevel(logging.INFO)
input_handler = logging.FileHandler("logs/input.log")
input_handler.setLevel(logging.INFO)
input_handler.setFormatter(logging.Formatter('%(asctime)s - %(message)s'))
input_logger.addHandler(input_handler)

# Configure a dedicated logger for model responses
response_logger = logging.getLogger("response_logger")
response_logger.setLevel(logging.INFO)
response_handler = logging.FileHandler("logs/response.log")
response_handler.setLevel(logging.INFO)
response_handler.setFormatter(logging.Formatter('%(asctime)s - %(message)s'))
response_logger.addHandler(response_handler)


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
from pydantic import BaseModel, validator
from typing import Optional
from enum import Enum
import uuid
import datetime

from sqlalchemy.dialects.postgresql import UUID as PGUUID
import config
from openai import AzureOpenAI
import tiktoken

def count_tokens(text: str, model: str = "gpt-4") -> int:
    try:
        encoding = tiktoken.encoding_for_model(model)
        return len(encoding.encode(text))
    except KeyError:
        # Fallback to approximate calculation if model not found
        return len(text) // 4

app = FastAPI()

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

# Add security middleware
app.add_middleware(HTTPSRedirectMiddleware)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.update({
        "Content-Security-Policy": (
            # default-src controls the global fallback
            "default-src 'self' https://liveonshuffle.com; "
            
            # scripts
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
            
            # styles – single directive for inline styles
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
            
            # images
            "img-src 'self' data:; "
            
            # fonts
            "font-src 'self' data:; "
            
            # XHR, fetch
            "connect-src 'self';"
        ),
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block"
    })
    return response

@app.on_event("startup")
async def init_db():
    async with engine.begin() as conn:
        # Create tables sequentially
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            )"""))
        
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                role VARCHAR(20) NOT NULL,
                content TEXT NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )"""))
            
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES sessions(id),
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                size BIGINT NOT NULL,
                upload_time TIMESTAMPTZ DEFAULT NOW()
            )"""))
            
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS typing_activity (
                session_id UUID REFERENCES sessions(id),
                user_id UUID NOT NULL,
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (session_id, user_id)
            )"""))

app.mount("/static", StaticFiles(directory="static", html=True), name="static")

@app.get('/favicon.ico', include_in_schema=False)
async def favicon():
    return FileResponse("static/favicon.ico")

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
    id = Column(PGUUID, primary_key=True)
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
        PGUUID, 
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
    id = Column(PGUUID, primary_key=True)
    session_id = Column(PGUUID, ForeignKey("sessions.id"), nullable=False)
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
    api_version="2024-12-01-preview",
    azure_endpoint=str(config.AZURE_OPENAI_ENDPOINT),
    max_retries=3,
    timeout=60.0
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

    @validator('session_id')
    def validate_session_id(cls, value):
        try:
            from uuid import UUID as PyUUID
            PyUUID(value)
            return value
        except ValueError:
            raise ValueError("Invalid session ID format (must be a valid UUID)")


@app.get("/")
async def serve_root():
    base_path = os.path.dirname(__file__)
    index_file = os.path.join(base_path, "static", "index.html")
    if not os.path.exists(index_file):
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(index_file)


@app.post("/chat") 
@limiter.limit("10/minute")
async def chat(request: Request, chat_message: ChatMessage):
    start_time = perf_counter()
    logger.info(f"Chat request received from session {chat_message.session_id}")
    session_id = chat_message.session_id

    # Log the user input
    input_logger.info(chat_message.message)

    messages = []

    # Retrieve previous conversation history for this session
    async with AsyncSessionLocal() as db_session:
        result = await db_session.execute(
            text("""
                SELECT role, content 
                FROM conversations
                WHERE session_id = :session_id
                ORDER BY timestamp ASC
            """),
            {"session_id": session_id}
        )
        history = result.mappings().all()
    for entry in history:
        messages.append({"role": entry["role"], "content": entry["content"]})

    # Append developer configuration if provided
    if chat_message.developer_config:
        formatted_content = chat_message.developer_config
        has_code = ("```" in chat_message.message or "code" in chat_message.message.lower())
        if has_code:
            formatted_content = ("Formatting re-enabled - code output should be wrapped in markdown.\n" +
                                 formatted_content)
        else:
            formatted_content = "Formatting re-enabled\n" + formatted_content
        messages.append({
            "role": "developer",
            "content": formatted_content
        })

    # Append the current user message
    # (File context will be appended to this message below)
    user_message = {"role": "user", "content": chat_message.message}
    messages.append(user_message)

    # Get uploaded files for context and append to current user message
    async with AsyncSessionLocal() as db_session:
        result = await db_session.execute(
            text("""
                SELECT filename, content 
                FROM uploaded_files 
                WHERE session_id = :session_id
            """),
            {"session_id": session_id}
        )
        files = result.mappings().all()
    using_file_context = False
    for file in files:
        user_message["content"] += (
            f"\n\nContext from file ({file['filename']}):\n"
            f"{file['content']}"
        )
        using_file_context = True

    try:
        params = {
            "model": str(config.AZURE_OPENAI_DEPLOYMENT_NAME),
            "messages": messages,
            "max_completion_tokens": 100000
        }

        # Only add reasoning effort for models that support it (e.g., o1-/o3-)
        model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
        is_reasoning = any(m in model_name for m in ["o1-", "o3-"]) and "preview" not in model_name
        if is_reasoning:
            params["reasoning_effort"] = validate_reasoning_effort(chat_message.reasoning_effort)
            logger.info(f"Using reasoning effort: {params['reasoning_effort']}")
        else:
            logger.info("No reasoning effort applied (model does not support it).")

        try:
            response = client.chat.completions.create(**params)

            # Attempt to log the raw JSON response
            import json
            try:
                # If your response has a to_dict() method, use that:
                if hasattr(response, "to_dict"):
                    raw_json = json.dumps(response.to_dict(), default=str, indent=2)
                else:
                    raw_json = json.dumps(response, default=str, indent=2)
                response_logger.info("Raw JSON response: %s", raw_json)
            except Exception as log_ex:
                response_logger.info("Failed to serialize raw response: %s", str(log_ex))
            
            assistant_msg = response.choices[0].message.content
        except Exception as e:
            print(f"Azure OpenAI API Error: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Error communicating with Azure OpenAI service"
            )

        assistant_msg = response.choices[0].message.content

        # Log the model's response
        response_logger.info(assistant_msg)

        # Save messages to database
        async with AsyncSessionLocal() as db_session:
            # Save current user message
            user_msg = Conversation(
                session_id=session_id,
                role="user",
                content=chat_message.message
            )
            db_session.add(user_msg)
            
            # Save assistant message
            assistant_msg_obj = Conversation(
                session_id=session_id,
                role="assistant",
                content=assistant_msg
            )
            db_session.add(assistant_msg_obj)
            await db_session.execute(
                text("UPDATE sessions SET last_activity = NOW() WHERE id = :session_id"),
                {"session_id": session_id}
            )
            await db_session.commit()

        elapsed = perf_counter() - start_time
        tokens = {
            "prompt": response.usage.prompt_tokens if response.usage else 0,
            "completion": response.usage.completion_tokens if response.usage else 0,
            "total": response.usage.total_tokens if response.usage else 0
        }
            
        logger.info(
            f"Chat request completed in {elapsed:.2f}s - "
            f"Tokens used: {tokens['total']} "
            f"(prompt: {tokens['prompt']}, completion: {tokens['completion']})"
        )
            
        return {
            "response": assistant_msg,
            "using_file_context": using_file_context,
            "usage": {
                "prompt_tokens": tokens["prompt"],
                "completion_tokens": tokens["completion"], 
                "total_tokens": tokens["total"]
            }
        }
    except Exception as e:
        logger.error(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    session_id: str = Form(...)
):
    logger.info(f"File upload request received: {file.filename} for session {session_id}")
    if not session_id:
        raise HTTPException(status_code=400, detail="Session ID is required")

    async with AsyncSessionLocal() as db_session:
        session = await db_session.get(Session, session_id)
        if not session:
            raise HTTPException(status_code=400, detail="Invalid session ID")

        try:
            contents = await file.read()
            try:
                file_text = contents.decode('utf-8')
                if len(file_text) > 100000:
                    file_text = (
                        file_text[:100000] +
                        "\n[Content truncated due to length]"
                    )

                file_id = uuid.uuid4()
                uploaded_file = UploadedFile(
                    id=file_id,
                    session_id=session_id,
                    filename=file.filename or "unnamed_file.txt",
                    content=file_text,
                    size=len(contents)
                )
                db_session.add(uploaded_file)
                await db_session.commit()

                char_count = len(file_text)
                metadata = {
                    "filename": file.filename,
                    "size": len(contents),
                    "upload_time": uploaded_file.upload_time.isoformat(),
                    "char_count": char_count,
                    "token_count": count_tokens(file_text),
                    "encoding_model": config.AZURE_OPENAI_DEPLOYMENT_NAME
                }
                
                logger.info(
                    f"File uploaded successfully: {file.filename} "
                    f"({metadata['size']} bytes, ~{metadata['estimated_tokens']} tokens)"
                )
                
                return {
                    "message": "File uploaded successfully",
                    "file_id": str(file_id),
                    "metadata": metadata
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
    async with AsyncSessionLocal() as db_session:
        result = await db_session.execute(
            text("""
                SELECT id, filename, size, 
                    upload_time, length(content) as char_count
                FROM uploaded_files 
                WHERE session_id = :session_id
            """),
            {"session_id": session_id}
        )
        files = result.mappings().all()

        return {
            "files": [{
                "file_id": str(file["id"]),
                "filename": file["filename"],
                "size": file["size"],
                "upload_time": file["upload_time"].isoformat(),
                "char_count": file["char_count"],
                "token_count": count_tokens(file["content"]),
                "encoding_model": config.AZURE_OPENAI_DEPLOYMENT_NAME
            } for file in files]
        }


@app.delete("/files/{session_id}/{file_id}")
async def delete_file(session_id: str, file_id: str):
    async with AsyncSessionLocal() as db_session:
        result = await db_session.execute(
            text("""
                DELETE FROM uploaded_files 
                WHERE session_id = :session_id AND id = :file_id
                RETURNING id
            """),
            {"session_id": session_id, "file_id": file_id}
        )
        if not result.first():
            raise HTTPException(status_code=404, detail="File not found")
        await db_session.commit()
        return {"message": "File deleted successfully"}


@app.websocket("/ws/typing/{session_id}")
async def websocket_typing(websocket: WebSocket, session_id: str):
    await websocket.accept()
    user_id = str(uuid.uuid4())

    try:
        while True:
            await websocket.receive_text()
            async with AsyncSessionLocal() as db_session:
                await db_session.execute(
                    text("""
                        INSERT INTO typing_activity 
                            (session_id, user_id, last_activity)
                        VALUES (:session_id, :user_id, NOW())
                        ON CONFLICT (session_id, user_id) 
                        DO UPDATE SET last_activity = NOW()
                    """),
                    {"session_id": session_id, "user_id": user_id}
                )
                await db_session.commit()
                
                result = await db_session.execute(
                    text("""
                        SELECT user_id 
                        FROM typing_activity 
                        WHERE session_id = :session_id 
                        AND last_activity > NOW() - 
                            INTERVAL '2 seconds'
                    """),
                    {"session_id": session_id}
                )
                active_typers = [str(row[0]) for row in result]
                
            await websocket.send_json({"typing_users": active_typers})

    except WebSocketDisconnect:
        async with AsyncSessionLocal() as db_session:
            await db_session.execute(
                text("""
                    DELETE FROM typing_activity 
                    WHERE session_id = :session_id AND user_id = :user_id
                """),
                {"session_id": session_id, "user_id": user_id}
            )
            await db_session.commit()


@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.datetime.utcnow()}

@app.post("/new_session")
async def new_session():
    session_id = uuid.uuid4()
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        minutes=config.SESSION_TIMEOUT_MINUTES
    )
    
    async with AsyncSessionLocal() as session:
        new_session = Session(
            id=session_id,
            expires_at=expires_at
        )
        session.add(new_session)
        await session.commit()
    
    return {"session_id": str(session_id)}

@app.get("/new_session")
async def reject_new_session_get():
    raise HTTPException(
        status_code=405,
        detail="Use POST method to create new session"
    )

@app.get("/conversation/{session_id}")
async def get_conversation(session_id: str):
    async with AsyncSessionLocal() as db_session:
        result = await db_session.execute(
            text("""SELECT role, content, timestamp FROM conversations WHERE session_id = :session_id ORDER BY timestamp ASC"""),
            {"session_id": session_id}
        )
        history = result.mappings().all()
    return {
        "conversation": [
            {
                "role": row["role"],
                "content": row["content"],
                "timestamp": row["timestamp"].isoformat()
            } for row in history
        ]
    }

@app.delete("/conversation/{session_id}")
async def clear_conversation(session_id: str):
    async with AsyncSessionLocal() as db_session:
        await db_session.execute(
            text("DELETE FROM conversations WHERE session_id = :session_id"),
            {"session_id": session_id}
        )
        await db_session.commit()
    return {"message": "Conversation history cleared"}
    raise HTTPException(
        status_code=405,
        detail="Use POST method to create new session"
    )
