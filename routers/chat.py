# routers/chat.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncAzureOpenAI
from database import get_db_session
from clients import get_azure_client
from models import ChatMessage
from services.chat_service import process_chat_message
from errors import create_error_response
from logging_config import logger
import config
router = APIRouter(prefix="/chat")
from fastapi.responses import StreamingResponse

@router.post("/stream")
async def stream_chat_response(
    message: ChatMessage,
    client: AsyncAzureOpenAI = Depends(get_azure_client)
):
    async def generate():
        try:
            response = await client.chat.completions.create(
                model=config.AZURE_OPENAI_DEPLOYMENT_NAME,
                messages=[{"role": "user", "content": message.message}],
                stream=True,
                max_completion_tokens=message.max_completion_tokens
            )
            
            async for chunk in response:
                yield f"data: {chunk.model_dump_json()}\n\n"
                
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@router.get("/model/capabilities")
async def get_model_capabilities():
    from services.chat_service import get_model_config
    config_dict = get_model_config()
    return {
        "model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "capabilities": {
            "supports_streaming": config_dict.get("supports_streaming", False),
            "supports_vision": config_dict.get("supports_vision", False),
            "max_tokens": config_dict.get("max_completion_tokens_default", 4096) if "max_completion_tokens_default" in config_dict else config_dict.get("max_tokens_default", 4096),
            "api_version": config_dict.get("api_version")
        }
    }
