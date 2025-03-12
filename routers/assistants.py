from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic_models import AssistantCreateRequest, AssistantObject
from database import get_db_session
from typing import List
from errors import create_error_response
import uuid
import datetime
import config

router = APIRouter()

from fastapi import Query, Path
from typing import Optional
from pydantic_models import ListAssistantsResponse, DeleteAssistantResponse
import config

@router.get("/assistants", response_model=ListAssistantsResponse)
async def list_assistants(
    limit: int = Query(20, ge=1, le=100),
    order: str = Query("desc", regex="^(asc|desc)$"),
    after: Optional[str] = None,
    before: Optional[str] = None,
    api_version: str = Query(..., alias="api-version")
):
    if api_version != config.AZURE_OPENAI_API_VERSION:
        raise create_error_response(
            status_code=400,
            code="invalid_api_version",
            message=f"Invalid API version. Expected {config.AZURE_OPENAI_API_VERSION}",
            param="api-version"
        )
    pass

@router.post("/assistants", response_model=AssistantObject)
async def create_assistant(
    request: AssistantCreateRequest,
    api_version: str = Query(..., alias="api-version"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    try:
        assistant_id: str = str(uuid.uuid4())
        assistant_object: str = "assistant"
        assistant_created_at: int = int(datetime.datetime.now().timestamp())
        assistant_name: Optional[str] = request.name if request.name else None
        assistant_description: Optional[str] = request.description if request.description else None
        assistant_model: str = request.model if request.model else ""
        assistant_instructions: Optional[str] = request.instructions if request.instructions else None
        assistant_tools: List = request.tools if request.tools else []
        assistant_file_ids: List[str] = request.file_ids if request.file_ids else []
        assistant_metadata = request.metadata if request.metadata else {}

        return AssistantObject(
            id=assistant_id,
            object=assistant_object,
            created_at=assistant_created_at,
            name=assistant_name,
            description=assistant_description,
            model=assistant_model,
            instructions=assistant_instructions,
            tools=assistant_tools,
            file_ids=assistant_file_ids,
            metadata=assistant_metadata
        )
    except Exception as e:
        raise create_error_response(
            status_code=500,
            code="assistant_creation_error",
            message=str(e)
        )