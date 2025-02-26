import config
from fastapi import APIRouter, Depends, HTTPException
from typing import Any, Dict, Optional

from services.config_service import get_config_service, ConfigService
from pydantic import BaseModel, Field, validator
from clients import get_client_pool, ClientPool

router = APIRouter(prefix="/config", tags=["Configuration"])


class ConfigUpdate(BaseModel):
    value: Any = Field(..., description="Configuration value")
    description: str = ""
    is_secret: bool = False

    @validator("value")
    def validate_value(cls, v, values, **kwargs):
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
async def update_config(
    key: str, update: ConfigUpdate, config_service=Depends(get_config_service)
):
    """
    Update a configuration specified by key.
    """
    # If we need the config key for validation
    update.value = ConfigUpdate.validate_value(update.value, {})
    success = await config_service.set_config(
        key, update.value, update.description, update.is_secret
    )
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
        "azureOpenAI": {"apiKey": config.AZURE_OPENAI_API_KEY},
        "models": {
            config.AZURE_OPENAI_DEPLOYMENT_NAME: {
                "endpoint": config.AZURE_OPENAI_ENDPOINT,
                "api_version": config.AZURE_OPENAI_API_VERSION,
            }
        },
    }


class ModelConfigModel(BaseModel):
    name: str
    max_tokens: int
    supports_streaming: bool
    supports_temperature: bool
    api_version: str
    azure_endpoint: str
    description: str = ""
    base_timeout: float = 120.0
    max_timeout: float = 300.0
    token_factor: float = 0.05


@router.get("/models", response_model=Dict[str, ModelConfigModel])
async def get_models(config_service=Depends(get_config_service)):
    """Get all model configurations"""
    try:
        models = await config_service.get_model_configs()
        print(f"Retrieved models: {models}")
        
        # Ensure DeepSeek-R1 is in the models list
        if "DeepSeek-R1" not in models:
            print("DeepSeek-R1 not found in models, adding it")
            deepseek_config = {
                "name": "DeepSeek-R1",
                "description": "Model that supports chain-of-thought reasoning with <think> tags",
                "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                "api_version": "2024-05-01-preview",
                "max_tokens": 32000,
                "supports_temperature": True,
                "supports_streaming": True,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05
            }
            
            # Add DeepSeek-R1 to models
            models["DeepSeek-R1"] = deepseek_config
            
            # Save updated models to database
            await config_service.set_config(
                "model_configs",
                models,
                "Updated with DeepSeek-R1 model",
                is_secret=True
            )
            
            # Refresh client pool
            from clients import get_client_pool
            pool = await get_client_pool()
            await pool.refresh_client("DeepSeek-R1", config_service)
        
        # Debug output to see what we're returning
        model_names = list(models.keys())
        print(f"Returning models: {model_names}")
        
        return models
    except Exception as e:
        print(f"Error retrieving models: {str(e)}")
        # Return empty dict instead of raising error to avoid UI disruption
        return {}


@router.get("/models/{model_id}", response_model=ModelConfigModel)
async def get_model(model_id: str, config_service=Depends(get_config_service)):
    """Get a specific model configuration"""
    model = await config_service.get_model_config(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.post("/models/{model_id}")
async def create_model(
    model_id: str, model: ModelConfigModel, config_service=Depends(get_config_service)
):
    """Create a new model configuration"""
    try:
        print(f"Creating model {model_id} with config: {model.dict()}")
        existing = await config_service.get_model_config(model_id)
        if existing:
            raise HTTPException(status_code=400, detail="Model already exists")

        success = await config_service.add_model_config(model_id, model.dict())
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create model")

        # Refresh client pool
        from clients import get_client_pool

        pool = await get_client_pool()
        await pool.refresh_client(model_id, config_service)

        return {"status": "created", "model_id": model_id}
    except Exception as e:
        print(f"Error creating model {model_id}: {str(e)}")
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/models/{model_id}")
async def update_model(
    model_id: str, model: ModelConfigModel, config_service=Depends(get_config_service)
):
    """Update an existing model configuration"""
    existing = await config_service.get_model_config(model_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Model not found")

    success = await config_service.update_model_config(model_id, model.dict())
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update model")

    # Refresh client pool
    from clients import get_client_pool

    pool = await get_client_pool()
    await pool.refresh_client(model_id, config_service)

    return {"status": "updated", "model_id": model_id}


@router.delete("/models/{model_id}")
async def delete_model(model_id: str, config_service=Depends(get_config_service)):
    """Delete a model configuration"""
    existing = await config_service.get_model_config(model_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Model not found")

    # Prevent deleting the default model
    if model_id == config.AZURE_OPENAI_DEPLOYMENT_NAME:
        raise HTTPException(status_code=400, detail="Cannot delete default model")

    success = await config_service.delete_model_config(model_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete model")

    return {"status": "deleted", "model_id": model_id}


# Add a simplified endpoint with directly specified parameters
@router.post("/models/switch_model/{model_id}")
async def switch_model_simple(
    model_id: str,
    session_id: Optional[str] = None,
    client_pool: ClientPool = Depends(get_client_pool),
    config_service: ConfigService = Depends(get_config_service),
):
    """Switch the active model for the current session - simplified endpoint"""
    print(f"DEBUG - switch_model_simple called with model_id={model_id}, session_id={session_id}")
    
    if not model_id:
        raise HTTPException(status_code=400, detail="Model ID is required")
        
    # Verify model exists in configs
    model_configs = await config_service.get_model_configs()
    
    # For DeepSeek-R1, create it if needed
    if model_id == "DeepSeek-R1" and model_id not in model_configs:
        print("Creating DeepSeek-R1 model in configs")
        deepseek_config = {
            "name": "DeepSeek-R1",
            "max_tokens": 32000,
            "supports_streaming": True,
            "supports_temperature": True,
            "base_timeout": 120.0,
            "max_timeout": 300.0,
            "token_factor": 0.05,
            "api_version": config.AZURE_INFERENCE_API_VERSION,
            "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
            "description": "Model that supports chain-of-thought reasoning with <think> tags"
        }
        await config_service.add_model_config(model_id, deepseek_config)
        model_configs = await config_service.get_model_configs()
    
    if model_id not in model_configs:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")
        
    # Store the selected model in the session
    if session_id:
        from database import AsyncSessionLocal
        async with AsyncSessionLocal() as db_session:
            from sqlalchemy import update
            from models import Session
            await db_session.execute(
                update(Session)
                .where(Session.id == session_id)
                .values(last_model=model_id)
            )
            await db_session.commit()
            
    return {"success": True, "model": model_id}

class ModelSwitchRequest(BaseModel):
    model_id: str
    session_id: Optional[str] = None

@router.post("/models/switch")
async def switch_model(
    request: ModelSwitchRequest,
    client_pool: ClientPool = Depends(get_client_pool),
    config_service: ConfigService = Depends(get_config_service),
):
    """Switch the active model for the current session"""
    print(f"DEBUG - switch_model received request: {request}")
    model_id = request.model_id
    session_id = request.session_id

    if not model_id:
        raise HTTPException(status_code=400, detail="Model ID is required")

    # Verify model exists in configs
    model_configs = await config_service.get_model_configs()
    if model_id not in model_configs:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    # Store the selected model in the session
    if session_id:
        # Update the session's last_model field
        from database import AsyncSessionLocal

        async with AsyncSessionLocal() as db_session:
            from sqlalchemy import update
            from models import Session

            await db_session.execute(
                update(Session)
                .where(Session.id == session_id)
                .values(last_model=model_id)
            )
            await db_session.commit()

    return {"success": True, "model": model_id}
