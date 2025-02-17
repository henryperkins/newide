from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict
import uuid
import json
import datetime
 
import config
from openai import AzureOpenAI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
 
app = FastAPI()
 
app.mount("/static", StaticFiles(directory="static"), name="static")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def serve_root():
    return FileResponse("static/index.html")

# Initialize Azure OpenAI client
client = AzureOpenAI(
    api_key=config.AZURE_OPENAI_API_KEY,
    api_version=config.AZURE_OPENAI_API_VERSION,
    azure_endpoint=config.AZURE_OPENAI_ENDPOINT
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

file_store: Dict[str, Dict[str, FileMetadata]] = {}  # session_id -> {file_id -> metadata}

class ChatMessage(BaseModel):
    message: str
    session_id: str
    developer_config: Optional[str] = None

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
        messages.append({"role": "developer", "content": chat_message.developer_config})
    
    # Add conversation history
    messages.extend(conversations[session_id])
    
    # Add the new user message
    messages.append({"role": "user", "content": chat_message.message})
    
    # Add file context from file_store if available
    if session_id in file_store:
        for file_id, metadata in file_store[session_id].items():
            messages[-1]["content"] += f"\n\nContext from file ({metadata.filename}):\n{metadata.content}"
    
    try:
        # Call Azure OpenAI API
        try:
            # Note: o1 model requirements:
            # - Use max_completion_tokens (not max_tokens)
            # - No streaming, temperature, top_p, presence_penalty, frequency_penalty, logprobs, or logit_bias
            # - Optional: reasoning_effort parameter
            response = client.chat.completions.create(
                model=config.AZURE_OPENAI_DEPLOYMENT_NAME,
                messages=messages,
                max_completion_tokens=2000,  # Required for o1 model
                reasoning_effort="medium"    # Optional for o1 model (low/medium/high)
            )
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
        conversations[session_id].append({"role": "user", "content": chat_message.message})
        conversations[session_id].append({"role": "assistant", "content": assistant_message})
        
        # Return response with token usage
        return {
            "response": assistant_message,
            "usage": {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), session_id: str = None):
    if not session_id:
        raise HTTPException(status_code=400, detail="Session ID is required")
    
    try:
        contents = await file.read()
        try:
            file_text = contents.decode('utf-8')
            # Basic content validation and truncation if needed
            if len(file_text) > 100000:
                file_text = file_text[:100000] + "\n[Content truncated due to length]"
            
            # Generate unique file ID
            file_id = str(uuid.uuid4())
            
            # Create file metadata
            file_metadata = FileMetadata(
                filename=file.filename,
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

@app.post("/new_session")
async def new_session():
    session_id = str(uuid.uuid4())
    conversations[session_id] = []
    return {"session_id": session_id}