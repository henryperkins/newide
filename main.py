from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket
from fastapi.websockets import WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import time
from pydantic import BaseModel
from typing import Optional, List, Dict
, Any
from pydantic import constr
import uuid
import datetime


import config
from openai import AzureOpenAI



app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Initialize Azure OpenAI client
client = AzureOpenAI(
    api_key=str(config.AZURE_OPENAI_API_KEY),
    api_version="2025-01-01-preview",
    azure_endpoint=str(config.AZURE_OPENAI_ENDPOINT)
)


@app.get("/")
async def serve_root():
    return FileResponse("static/index.html")


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


ReasoningEffort = constr(regex='^(low|medium|high)$')

def validate_reasoning_effort(value: str) -> ReasoningEffort:
    return value if value in ('low', 'medium', 'high') else 'medium'


class ChatMessage(BaseModel):
    message: str
    session_id: str
    developer_config: Optional[str] = None

    reasoning_effort: Optional[ReasoningEffort] = None



@app.post("/chat")
async def chat(chat_message: ChatMessage):
    session_id = chat_message.session_id
    
    # Initialize conversation history if needed
    if session_id not in conversations:
        conversations[session_id] = []
    
    # Prepare messages for the API call
    messages = []
    
    # Add developer message if provided (equivalent to system message)
    if chat_message.developer_config:
        # Prefix with Formatting re-enabled for markdown support
        formatted_content = chat_message.developer_config
        has_code = (
            "```" in chat_message.message or 
            "code" in chat_message.message.lower()
        )
        if has_code:
            formatted_content = (
                "Formatting re-enabled - code output should be wrapped in "
                "markdown.\n" + formatted_content
            )
        else:
            formatted_content = "Formatting re-enabled\n" + formatted_content
            
        messages.append({
            "role": "developer",
            "content": formatted_content
        })
    
    # Add conversation history
    messages.extend(conversations[session_id])
    
    # Add the new user message
    messages.append({"role": "user", "content": chat_message.message})
    
    using_file_context = False
    # Add file context from file_store if available
    if session_id in file_store:
        for file_id, metadata in file_store[session_id].items():
            messages[-1]["content"] += (
                f"\n\nContext from file ({metadata.filename}):\n"
                f"{metadata.content}"
            )
            using_file_context = True
    
    try:
        # Call Azure OpenAI API
        try:
            # o1 requirements:
            # - max_completion_tokens required
            # - Excluded params: streaming, top_p, etc.
            # - reasoning_effort optional
            params = {
                "model": str(config.AZURE_OPENAI_DEPLOYMENT_NAME),
                "messages": messages,
                "max_completion_tokens": 100000,  # Maximum output tokens
            }
            
            # Only add reasoning_effort for o1 and o3-mini models
            model_name = str(config.AZURE_OPENAI_DEPLOYMENT_NAME).lower()
            is_reasoning_model = (
                any(model in model_name for model in ["o1-", "o3-"]) and 
                "preview" not in model_name
            )
            if is_reasoning_model:
                params["reasoning_effort"] = validate_reasoning_effort(chat_message.reasoning_effort or "medium"
)
            
            response = client.chat.completions.create(**params)
        except Exception as e:
            # Log the error and provide a clear message
            print(f"Azure OpenAI API Error: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail="Error communicating with Azure OpenAI service"
            )
        
        # Extract the response
        assistant_message = response.choices[0].message.content
        
        # Update conversation history
        conversations[session_id].append({
            "role": "user",
            "content": chat_message.message
        })
        conversations[session_id].append({
            "role": "assistant",
            "content": assistant_message
        })
        
        # Return response with token usage and file context status
        return {
            "response": assistant_message,
            "using_file_context": using_file_context,
            "usage": {
                "prompt_tokens": (
                    response.usage.prompt_tokens if response.usage else 0
                ),
                "completion_tokens": (
                    response.usage.completion_tokens if response.usage else 0
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
    # File to upload
    session_id: str = Form(...),  # Get session_id from form data
):
    if not session_id:
        raise HTTPException(status_code=400, detail="Session ID is required")
    
    # Validate session exists
    if (
        session_id not in file_store and 
        session_id not in conversations
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid session ID. Please refresh the page.")
    
    try:
        contents = await file.read()
        try:
            file_text = contents.decode('utf-8')
            # Basic content validation and truncation if needed
            if len(file_text) > 100000:
                file_text = (
                    file_text[0:100000] +
                    "\n[Content truncated due to length]"
                )
            
            # Generate unique file ID
            file_id = str(uuid.uuid4())
            
            # Create file metadata
            file_metadata = FileMetadata(
                filename=file.filename or "unnamed_file.txt",
                content=file_text,
                size=len(contents),
                upload_time=datetime.datetime.now().isoformat(),
                char_count=len(file_text),
                estimated_tokens=len(file_text) // 4  # rough estimate
            )
            
            # Initialize session's file store if needed
            if session_id not in file_store:
                file_store[session_id] = {}
            
            # Store file metadata
            file_store[session_id][file_id] = file_metadata
            
            return {
                "message": "File uploaded successfully",
                "file_id": file_id,
                "metadata": {
                    "filename": file.filename,
                    "size": len(contents),
                    "upload_time": file_metadata.upload_time,
                    "char_count": len(file_text),
                    "estimated_tokens": file_metadata.estimated_tokens
                }
            }
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="File must be a valid UTF-8 text file"
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
    for file_id, metadata in file_store[session_id].items():
        files.append({
            "file_id": file_id,
            "filename": metadata.filename,
            "size": metadata.size,
            "upload_time": metadata.upload_time,
            "char_count": metadata.char_count,
            "estimated_tokens": metadata.estimated_tokens
        })
    
    return {"files": files}


@app.delete("/files/{session_id}/{file_id}")
async def delete_file(session_id: str, file_id: str):
    """Delete a file from the session"""
    if session_id not in file_store or file_id not in file_store[session_id]:
        raise HTTPException(status_code=404, detail="File not found")
    
    del file_store[session_id][file_id]
    return {"message": "File deleted successfully"}


# Track typing status {session_id: {user_id: last_typing_time}}
typing_status: Dict[str, Dict[str, float]] = {}


@app.websocket("/ws/typing/{session_id}")
async def websocket_typing(websocket: WebSocket, session_id: str):
    await websocket.accept()
    user_id = str(uuid.uuid4())
    
    try:
        while True:
            # Receive and broadcast typing status
            await websocket.receive_text()
            typing_status.setdefault(session_id, {})[user_id] = time.time()
            
            # Broadcast to all clients
            # Only show typers who were active in the last 2 seconds
            active_typers = [
                uid for uid, t in typing_status.get(session_id, {}).items()
                if time.time() - t < 2  # Only show recent typers
            ]
            await websocket.send_json({"typing_users": active_typers})
            
    except WebSocketDisconnect:
        del typing_status[session_id][user_id]


@app.post("/new_session")
async def new_session():
    session_id = str(uuid.uuid4())
    conversations[session_id] = []
    return {"session_id": session_id}

