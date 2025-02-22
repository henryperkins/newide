from fastapi import APIRouter, Depends, HTTPException
from services.config_service import ConfigService
from database import get_db_session
from pydantic import BaseModel
import json
import os

router = APIRouter(prefix="/config", tags=["Configuration"])

class ConfigUpdate(BaseModel):
    value: dict
    description: str = ""
    is_secret: bool = False

@router.get("/{key}")
async def get_config(key: str, config_service: ConfigService = Depends()):
    value = await config_service.get_config(key)
    if not value:
        raise HTTPException(status_code=404, detail="Config not found")
    return {key: value}

@router.put("/{key}")
async def update_config(key: str, update: ConfigUpdate, config_service: ConfigService = Depends()):
    await config_service.set_config(key, update.value, update.description, update.is_secret)
    return {"status": "updated"}

@router.get("/")
async def get_all_configs(config_service: ConfigService = Depends()):
    try:
        configs = await config_service.get_all_configs() or {}
        
        # Parse JSON values from database
        def parse_config(key, default):
            value = configs.get(key, default)
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    return value
            return value

        # Get deployment name from environment variable
        deployment_name = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "o1model-east2")

        # Get models config with API key
        models = {
            deployment_name: {
                "max_tokens": 40000,
                "temperature": 1.0,
                "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT"),
                "api_key": os.getenv("AZURE_OPENAI_API_KEY"),
                "api_version": os.getenv("AZURE_OPENAI_API_VERSION"),
                "deployment_name": deployment_name
            }
        }

        return {
            "selectedModel": deployment_name,
            "reasoningEffort": parse_config("reasoningEffort", "medium"),
            "includeFiles": parse_config("includeFiles", False),
            "models": models,
            "deploymentName": deployment_name
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=str(e)
        )
