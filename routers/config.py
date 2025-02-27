import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

from database import get_db_session, AsyncSessionLocal
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field, validator
from clients import get_client_pool, ClientPool, ModelRegistry
from services.config_service import get_config_service, ConfigService

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
async def get_all_configs(
    request: Request, config_service=Depends(get_config_service)
) -> dict:
    """
    Return configuration data in the format needed by the frontend
    """
    # Get client pool for model information
    client_pool = await get_client_pool()
    
    # Get model configurations 
    model_configs = client_pool.get_all_models()

    # Get the current session ID from the request
    session_id = None
    if "session_id" in request.cookies:
        session_id = request.cookies.get("session_id")

    # Try to get the selected model from the session
    selected_model = None
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

    # If no model from session, use first available
    if not selected_model and model_configs:
        selected_model = next(iter(model_configs.keys()))
        
    # Get deployment name from environment
    import config
    deployment_name = config.AZURE_OPENAI_DEPLOYMENT_NAME

    # Return the required shape with model configs and correct selected model
    return {
        "deploymentName": deployment_name,
        "selectedModel": selected_model or deployment_name,
        "azureOpenAI": {"apiKey": config.AZURE_OPENAI_API_KEY},
        "models": model_configs,
    }


class ModelConfigModel(BaseModel):
    name: str
    max_tokens: int
    supports_streaming: Optional[bool] = False
    supports_temperature: Optional[bool] = False
    api_version: str
    azure_endpoint: str
    description: str = ""
    base_timeout: float = 120.0
    max_timeout: float = 300.0
    token_factor: float = 0.05


@router.get("/models", response_model=Dict[str, ModelConfigModel])
async def get_models(db_session: AsyncSession = Depends(get_db_session)):
    """Get all model configurations"""
    try:
        # Get models from client pool
        client_pool = await get_client_pool(db_session)
        return client_pool.get_all_models()
    except Exception as e:
        logger.error(f"Error in get_models: {str(e)}")
        # Return default models from ModelRegistry
        return ModelRegistry.create_default_models()


@router.get("/models/{model_id}", response_model=None)
async def get_model(
    model_id: str, 
    db_session: AsyncSession = Depends(get_db_session)
):
    """Get a specific model configuration"""
    try:
        # Get model from client pool
        client_pool = await get_client_pool(db_session)
        model_config = client_pool.get_model_config(model_id)
        
        if model_config:
            return model_config
            
        # Check if this is a known model type that we can create
        if model_id.lower() == "deepseek-r1" or model_id.lower() == "o1hp":
            # Get template from registry
            model_config = ModelRegistry.get_model_template(model_id)
            
            # Add to client pool
            await client_pool.add_or_update_model(model_id, model_config, db_session)
            return model_config
            
        # Model not found
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")
    except HTTPException:
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
    db_session: AsyncSession = Depends(get_db_session),
):
    """Create a new model configuration"""
    try:
        logger.info(f"Creating model {model_id}")
        
        # Get client pool
        client_pool = await get_client_pool(db_session)
        
        # Check if model already exists
        existing_config = client_pool.get_model_config(model_id)
        if existing_config:
            return {
                "status": "exists", 
                "model_id": model_id,
                "message": f"Model already exists"
            }
            
        # If no model data provided, use template from registry
        if not model:
            model = ModelRegistry.get_model_template(model_id)
            
        # Add to client pool
        success = await client_pool.add_or_update_model(model_id, model, db_session)
        
        if not success:
            raise HTTPException(
                status_code=500, detail=f"Failed to create model {model_id}"
            )
            
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
    model_id: str, 
    model: ModelConfigModel, 
    db_session: AsyncSession = Depends(get_db_session)
):
    """Update an existing model configuration"""
    try:
        # Get client pool
        client_pool = await get_client_pool(db_session)
        
        # Check if model exists
        existing_config = client_pool.get_model_config(model_id)
        if not existing_config:
            raise HTTPException(status_code=404, detail="Model not found")
            
        # Update model
        success = await client_pool.add_or_update_model(
            model_id, 
            model.dict(), 
            db_session
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update model")
            
        return {"status": "updated", "model_id": model_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating model {model_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating model {model_id}: {str(e)}"
        )


@router.delete("/models/{model_id}")
async def delete_model(
    model_id: str, 
    db_session: AsyncSession = Depends(get_db_session)
):
    """Delete a model configuration"""
    try:
        # Get client pool
        client_pool = await get_client_pool(db_session)
        
        # Import config here to avoid circular import
        import config
        
        # Prevent deleting the default model
        if model_id == config.AZURE_OPENAI_DEPLOYMENT_NAME:
            raise HTTPException(status_code=400, detail="Cannot delete default model")
            
        # Delete model
        success = await client_pool.delete_model(model_id, db_session)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete model")
            
        return {"status": "deleted", "model_id": model_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error deleting model {model_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting model {model_id}: {str(e)}"
        )


class ModelSwitchRequest(BaseModel):
    model_id: str
    session_id: Optional[str] = None


@router.post("/models/switch")
async def switch_model(
    request: ModelSwitchRequest,
    db_session: AsyncSession = Depends(get_db_session),
):
    """Switch the active model for the current session"""
    try:
        model_id = request.model_id
        session_id = request.session_id

        if not model_id:
            raise HTTPException(status_code=400, detail="Model ID is required")
            
        # Get client pool
        client_pool = await get_client_pool(db_session)
        
        # Verify model exists
        model_config = client_pool.get_model_config(model_id)
        if not model_config:
            # Try to create it if it's a known model type
            if model_id.lower() == "deepseek-r1" or model_id.lower() == "o1hp":
                model_template = ModelRegistry.get_model_template(model_id)
                await client_pool.add_or_update_model(model_id, model_template, db_session)
            else:
                raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

        # Store the selected model in the session
        if session_id:
            from session_utils import SessionManager
            await SessionManager.update_session_model(session_id, model_id, db_session)

        return {"success": True, "model": model_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error switching model to {request.model_id}: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Error switching model: {str(e)}"
        )


@router.get("/models/debug", tags=["debug"])
async def debug_models(db_session: AsyncSession = Depends(get_db_session)):
    """Debug endpoint to check model configurations"""
    try:
        # Get client pool
        client_pool = await get_client_pool(db_session)
        
        # Get raw config from config service
        config_service = ConfigService(db_session)
        raw_config = await config_service.get_config("model_configs")
        
        # Get environment settings
        import config
        
        return {
            "status": "ok",
            "client_pool_models": client_pool.get_all_models(),
            "db_models": raw_config,
            "env_defaults": {
                "AZURE_OPENAI_ENDPOINT": config.AZURE_OPENAI_ENDPOINT,
                "AZURE_INFERENCE_ENDPOINT": config.AZURE_INFERENCE_ENDPOINT,
                "default_model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
            },
        }
    except Exception as e:
        import traceback
        return {
            "status": "error", 
            "error": str(e), 
            "traceback": traceback.format_exc()
        }