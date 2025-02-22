from fastapi import APIRouter, Depends, HTTPException
from services.config_service import ConfigService
from database import get_db_session
from pydantic import BaseModel

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
        return {
            "selectedModel": configs.get("selectedModel", "o1"),
            "reasoningEffort": configs.get("reasoningEffort", "medium"),
            "includeFiles": configs.get("includeFiles", False),
            "models": configs.get("models", {})
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=str(e)
        )