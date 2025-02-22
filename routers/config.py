from fastapi import APIRouter, Depends, HTTPException
from services.config_service import ConfigService
from pydantic import BaseModel, Field, validator
from database import get_db_session
from typing import Any, Dict
import json
import os

router = APIRouter(prefix="/config", tags=["Configuration"])

def parse_config(key: str, default_value: Any) -> Any:
    try:
        return os.getenv(f"CONFIG_{key.upper()}", default_value)
    except Exception:
        return default_value

class ConfigUpdate(BaseModel):
    value: Any = Field(..., description="Configuration value")
    description: str = ""
    is_secret: bool = False
    
    @validator('value')
    def validate_value(cls, v, values, **kwargs):
        # Get config key from context
        config_key = kwargs.get('config_key', '')
        
        if config_key == 'reasoningEffort':
            if not isinstance(v, str) or v not in ['low', 'medium', 'high']:
                raise ValueError("reasoningEffort must be one of: low, medium, high")
        elif config_key == 'includeFiles':
            if not isinstance(v, bool):
                raise ValueError("includeFiles must be a boolean")
        elif config_key == 'selectedModel' or config_key == 'developerConfig':
            if not isinstance(v, str):
                raise ValueError(f"{config_key} must be a string")
        elif config_key == 'azureOpenAI':
            if not isinstance(v, dict):
                raise ValueError("azureOpenAI must be a dictionary")
            required_fields = ['apiKey', 'endpoint', 'deploymentName', 'apiVersion']
            missing_fields = [f for f in required_fields if f not in v]
            if missing_fields:
                raise ValueError(f"Missing required fields in azureOpenAI config: {', '.join(missing_fields)}")
        return v

@router.get("/{key}")
async def get_config(key: str, config_service: ConfigService = Depends()):
    value = await config_service.get_config(key)
    if not value:
        raise HTTPException(status_code=404, detail="Config not found")
    return {key: value}

@router.put("/{key}")
async def update_config(key: str, update: ConfigUpdate, config_service: ConfigService = Depends()):
    try:
        # Pass config key to validator
        update.value = ConfigUpdate.validate_value(update.value, {}, config_key=key)
        await config_service.set_config(key, update.value, update.description, update.is_secret)
        return {"status": "updated"}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

@router.get("/")
async def get_all_configs(config_service: ConfigService = Depends()):
    try:
        configs = await config_service.get_all_configs()
        
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
            "deploymentName": deployment_name,
            "azureOpenAI": {
                "apiKey": os.getenv("AZURE_OPENAI_API_KEY"),
                "endpoint": os.getenv("AZURE_OPENAI_ENDPOINT"),
                "deploymentName": deployment_name,
                "apiVersion": os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))