import config
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Any, Dict, Optional, List
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

from services.config_service import get_config_service, ConfigService
from clients import get_client_pool, ClientPool
from database import AsyncSessionLocal
from utils.model_utils import is_deepseek_model, is_o_series_model

router = APIRouter(prefix="/config", tags=["Configuration"])


class ConfigUpdate(BaseModel):
    value: Any = Field(..., description="Configuration value")
    description: str = ""
    is_secret: bool = False


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
    success = await config_service.set_config(
        key, update.value, update.description, update.is_secret
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update config")
    return {"status": "updated"}


@router.get("/", response_model=None)
async def get_all_configs(
    request: Request, config_service=Depends(get_config_service)
) -> dict:
    """
    Return configuration data in the format needed by the frontend
    (deploymentName, azureOpenAI -> apiKey, models -> {deploymentName:{endpoint:...}}).
    """
    # Get model configurations from database
    model_configs = await config_service.get_model_configs()

    # Get the current session ID from the request
    session_id = None
    if "session_id" in request.cookies:
        session_id = request.cookies.get("session_id")

    # Try to get the selected model from the session
    selected_model = config.AZURE_OPENAI_DEPLOYMENT_NAME
    if session_id:
        try:
            async with AsyncSessionLocal() as db:
                from sqlalchemy import select
                from models import Session

                result = await db.execute(
                    select(Session.last_model).where(Session.id == session_id)
                )
                session_model = result.scalar_one_or_none()
                if session_model:
                    selected_model = session_model
        except Exception as e:
            logger.error(f"Error fetching session model: {str(e)}")

    # Return the required shape with model configs and correct selected model
    return {
        "deploymentName": config.AZURE_OPENAI_DEPLOYMENT_NAME,
        "selectedModel": selected_model,
        "azureOpenAI": {"apiKey": config.AZURE_OPENAI_API_KEY},
        "models": model_configs,
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
        logger.info(f"Retrieved models from config_service: {list(models.keys())}")
        return models
    except Exception as e:
        logger.error(f"Error in get_models: {str(e)}")
        # Return empty dict on error
        return {}


@router.get("/models/{model_id}", response_model=None)
async def get_model(model_id: str, config_service=Depends(get_config_service)):
    """Get a specific model configuration"""
    try:
        # First check if the model exists in the configs
        model_config = await config_service.get_model_config(model_id)

        if model_config:
            return model_config

        # If not in configs, raise not found
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.exception(f"Error in get_model for {model_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Server error retrieving model configuration: {str(e)}",
        )


@router.post("/models/{model_id}")
async def create_model(
    model_id: str,
    model: Optional[Dict[str, Any]] = None,
    config_service=Depends(get_config_service),
):
    """Create a new model configuration with better error handling"""
    try:
        logger.info(f"Creating model {model_id}")

        # Check if model exists first
        model_configs = await config_service.get_model_configs()
        if model_id in model_configs:
            raise HTTPException(
                status_code=400, detail=f"Model {model_id} already exists"
            )

        # If no model data is provided, create default based on model name
        if not model:
            if is_deepseek_model(model_id):
                model = {
                    "name": "DeepSeek-R1",
                    "description": "Model that supports chain-of-thought reasoning with <think> tags",
                    "max_tokens": 32000,
                    "supports_streaming": True,
                    "supports_temperature": True,
                    "api_version": config.AZURE_INFERENCE_API_VERSION,
                    "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                    "base_timeout": 120.0,
                    "max_timeout": 300.0,
                    "token_factor": 0.05,
                }
            elif is_o_series_model(model_id):
                model = {
                    "name": model_id,
                    "description": "Advanced reasoning model for complex tasks",
                    "max_tokens": 200000,
                    "max_completion_tokens": 5000,
                    "supports_temperature": False,
                    "supports_streaming": False,
                    "supports_vision": True,
                    "requires_reasoning_effort": True,
                    "reasoning_effort": "medium",
                    "base_timeout": 120.0,
                    "max_timeout": 300.0,
                    "token_factor": 0.05,
                    "api_version": config.AZURE_OPENAI_API_VERSION,
                    "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                }
            else:
                raise HTTPException(
                    status_code=400, detail="Model data is required for custom models"
                )

        # Create the model
        success = await config_service.add_model_config(model_id, model)
        if not success:
            raise HTTPException(
                status_code=500, detail=f"Failed to create model {model_id}"
            )

        # Refresh client pool to include new model
        from clients import get_client_pool

        pool = await get_client_pool()
        await pool.refresh_client(model_id, config_service)

        return {"status": "created", "model_id": model_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error creating model {model_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error creating model {model_id}: {str(e)}"
        )


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
    model_id = request.model_id
    session_id = request.session_id

    if not model_id:
        raise HTTPException(status_code=400, detail="Model ID is required")

    # Verify model exists in configs
    model_configs = await config_service.get_model_configs()
    if model_id not in model_configs:
        # Try to create the model if it's a known type
        if is_deepseek_model(model_id) or is_o_series_model(model_id):
            logger.info(f"Model {model_id} not found. Creating it based on type.")
            
            # Create model based on type
            if is_deepseek_model(model_id):
                await create_model(model_id, None, config_service)
            elif is_o_series_model(model_id):
                await create_model(model_id, None, config_service)
                
            # Refresh model configs
            model_configs = await config_service.get_model_configs()
        else:
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

    # Optionally refresh the client for this model
    try:
        await client_pool.refresh_client(model_id, config_service)
    except Exception as e:
        logger.warning(f"Could not refresh client for {model_id}: {str(e)}")
        # Continue even if refresh fails - don't block model switching

    return {"success": True, "model": model_id}