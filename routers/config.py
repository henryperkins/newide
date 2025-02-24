import config
from fastapi import APIRouter, Depends, HTTPException
from typing import Any
import json
import os

from services.config_service import get_config_service, ConfigService
from pydantic import BaseModel, Field, validator

router = APIRouter(prefix="/config", tags=["Configuration"])

class ConfigUpdate(BaseModel):
    value: Any = Field(..., description="Configuration value")
    description: str = ""
    is_secret: bool = False
    
    @validator('value')
    def validate_value(cls, v, values, **kwargs):
        config_key = kwargs.get('config_key', '')
        # Additional domain-specific validation can be inserted here.
        return v

@router.get("/{key}", response_model=None)
async def get_config(key: str, config_service=Depends(get_config_service)) -> dict:
    """
    Retrieve a configuration by key, returning as a raw dict.
    response_model=None ensures no Pydantic parse of the DB session or the result.
    """
    val = await config_service.get_config(key)
    if not val:
        raise HTTPException(status_code=404, detail="Config not found")
    return {key: val}

@router.put("/{key}", response_model=None)
async def update_config(key: str, update: ConfigUpdate, config_service=Depends(get_config_service)):
    """
    Update a configuration specified by key.
    """
    # If we need the config key for validation
    update.value = ConfigUpdate.validate_value(update.value, {}, config_key=key)
    success = await config_service.set_config(key, update.value, update.description, update.is_secret)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update config")
    return {"status": "updated"}

@router.get("/", response_model=None)
async def get_all_configs(config_service=Depends(get_config_service)) -> dict:
    """
    Return configuration data in the format needed by the frontend
    (deploymentName, azureOpenAI -> apiKey, models -> {deploymentName:{endpoint:...}}).
    """
    # Return the required shape directly from environment/config settings:
    return {
        "deploymentName": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "selectedModel": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "azureOpenAI": {
            "apiKey": config.AZURE_OPENAI_API_KEY
        },
        "models": {
            config.AZURE_OPENAI_DEPLOYMENT_NAME: {
                "endpoint": config.AZURE_OPENAI_ENDPOINT,
                "api_version": config.AZURE_OPENAI_API_VERSION
            }
        }
    }