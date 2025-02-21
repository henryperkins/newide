# routers/chat.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AzureOpenAI
from database import get_db_session
from clients import get_azure_client
from models import ChatMessage
from services.chat_service import process_chat_message
from errors import create_error_response
from logging_config import logger
import config
router = APIRouter(prefix="/chat")
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
