import logging
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from typing import Any, Optional, Dict
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db_session, AsyncSessionLocal
from clients import get_client_pool, ModelRegistry
from services.config_service import get_config_service, ConfigService
from services.session_service import SessionService
import config as app_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config", tags=["Configuration"])

# Model aliases - Map model aliases to actual model names
MODEL_ALIASES = {"o1hp": "o1"}  # o1hp is an alias for o1


# ==================================================================================
# Pydantic Models
# ==================================================================================

class ConfigUpdate(BaseModel):
    value: Any = Field(..., description="Configuration value")
    description: str = ""
    is_secret: bool = False

    @field_validator("value")
    @classmethod
    def validate_value(cls, v):
        # Additional domain-specific validation can be inserted here.
        return v


class ModelConfigModel(BaseModel):
    # Add a simple "model" field to validate; or adapt as needed for your logic
    model: str = Field(..., description="Model configuration name")

    name: str = Field(..., min_length=1, pattern=r"^[a-zA-Z0-9-_]+$")
    max_tokens: int = Field(..., gt=0, le=200000)
    supports_streaming: bool | None = False
    supports_temperature: bool | None = False
    api_version: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}(|-preview|-alpha\d+)$")
    azure_endpoint: str
    description: str = ""
    base_timeout: float = 120.0
    max_timeout: float = 300.0
    token_factor: float = 0.05
    model_type: str | None = Field("standard", alias="type")

    # O-Series specific fields
    reasoning_effort: str | None = None
    requires_reasoning_effort: bool | None = False

    # DeepSeek specific fields
    enable_thinking: bool | None = None
    thinking_tags: list[str] | None = None

    @field_validator("model")
    @classmethod
    def validate_model(cls, v):
        if not v:
            raise ValueError("Model configuration cannot be empty")
        return v

    @field_validator("model_type")
    @classmethod
    def validate_model_type(cls, v):
        if v not in ["o-series", "deepseek", "standard"]:
            return "standard"
        return v

    @model_validator(mode="after")
    @classmethod
    def check_model_specific_params(cls, values):
        model_type = values.get("model_type")
        if model_type == "o-series" and values.get("requires_reasoning_effort"):
            if not values.get("reasoning_effort"):
                values["reasoning_effort"] = "medium"
        if model_type == "deepseek" and values.get("enable_thinking") is None:
            values["enable_thinking"] = True
        return values


class ModelSwitchRequest(BaseModel):
    model_id: str
    session_id: Optional[str] = None


# ==================================================================================
# Helper Functions
# ==================================================================================

def is_deepseek_model(name: str) -> bool:
    """Check if model is DeepSeek-R1 with case-insensitive comparison"""
    return name.strip().lower() == "deepseek-r1"


# ==================================================================================
# Current Model Endpoints
# ==================================================================================

@router.get("/current-model", response_model=None)
async def get_current_model(
    request: Request, db_session: AsyncSession = Depends(get_db_session)
):
    """Get the current model for this session"""
    try:
        # Get session ID from cookies
        session_id = request.cookies.get("session_id")

        if not session_id:
            # No session found, return a default model instead of 404
            client_pool = await get_client_pool(db_session)
            models = client_pool.get_all_models()
            fallback_model = next(iter(models.keys())) if models else None

            # If no models available, use default from config
            if not fallback_model:
                fallback_model = app_config.AZURE_INFERENCE_DEPLOYMENT

            return {"currentModel": fallback_model}

        # Get session model from database using SessionService
        # Convert session_id string to UUID
        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError:
            # Invalid UUID, return default model
            client_pool = await get_client_pool(db_session)
            models = client_pool.get_all_models()
            fallback_model = next(iter(models.keys())) if models else None
            return {"currentModel": fallback_model}
            
        # Use the SessionService to get the current model
        current_model = await SessionService.get_current_model(
            session_id=session_uuid,
            db_session=db_session
        )
        
        if current_model:
            return {"currentModel": current_model}
        else:
            # No model set in session yet
            client_pool = await get_client_pool(db_session)
            models = client_pool.get_all_models()
            fallback_model = next(iter(models.keys())) if models else None
            return {"currentModel": fallback_model}
    except Exception as e:
        logger.exception(f"Error getting current model: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving current model: {str(e)}"
        )


# ==================================================================================
# General Config Endpoints
# ==================================================================================

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
    deployment_name = app_config.AZURE_OPENAI_DEPLOYMENT_NAME

    # Return the required shape with model configs and correct selected model
    return {
        "deploymentName": deployment_name,
        "selectedModel": selected_model or deployment_name,
        "azureOpenAI": {"apiKey": app_config.AZURE_OPENAI_API_KEY},
        "models": model_configs,
    }


# ==================================================================================
# Model Configuration Endpoints
# (Move get_models ABOVE the dynamic route to avoid overshadowing)
# ==================================================================================

@router.get("/models")
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


@router.get("/{key}", response_model=None)
async def get_config(key: str, config_service=Depends(get_config_service)) -> dict:
    """
    Retrieve a configuration by key, returning as a raw dict.
    """
    # Check if this is a specific endpoint we want to handle differently
    if key == "current-model":
        raise HTTPException(
            status_code=404, detail="Use /api/config/current-model endpoint instead"
        )

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
    # Key-specific validation if needed
    if key == "special_config":
        # Validate that value meets specific requirements for this key
        if isinstance(update.value, str) and len(update.value) < 3:
            raise HTTPException(status_code=422, detail="Value must be at least 3 characters for this config")
    
    success = await config_service.set_config(
        key, update.value, update.description, update.is_secret
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update config")
    return {"status": "updated"}


@router.get("/models/{model_id}", response_model=None)
async def get_model(model_id: str, db_session: AsyncSession = Depends(get_db_session)):
    """Get a specific model configuration"""
    try:
        # Check for model aliases
        actual_model_id = MODEL_ALIASES.get(model_id.lower(), model_id)

        if actual_model_id != model_id:
            logger.info(f"Using {actual_model_id} as fallback for {model_id}")

        # Get model from client pool
        client_pool = await get_client_pool(db_session)
        model_config = client_pool.get_model_config(actual_model_id)

        if model_config:
            return model_config

        # Check if this is a known model type that we can create
        if actual_model_id.lower() == "deepseek-r1" or actual_model_id.lower() == "o1":
            # Get template from registry
            model_config = ModelRegistry.get_model_template(actual_model_id)

            # Add to client pool
            await client_pool.add_or_update_model(
                actual_model_id, model_config, db_session
            )
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
    if len(model_id) < 2:
        raise HTTPException(
            status_code=422, detail="Model ID must be at least 2 characters"
        )
    
    try:
        # Check for model aliases
        actual_model_id = MODEL_ALIASES.get(model_id.lower(), model_id)

        if actual_model_id != model_id:
            logger.info(f"Using {actual_model_id} as fallback for {model_id}")

        logger.info(f"Creating model {actual_model_id}")

        # Get client pool
        client_pool = await get_client_pool(db_session)

        # Check if model already exists
        existing_config = client_pool.get_model_config(actual_model_id)
        if existing_config:
            return {
                "status": "exists",
                "model_id": actual_model_id,
                "message": "Model already exists",
            }

        # If no model data provided, use template from registry
        if not model:
            model = ModelRegistry.get_model_template(actual_model_id)

        # Validate model configuration
        try:
            # Determine model type if not specified
            if "model_type" not in model and "type" not in model:
                if model_id.lower().startswith(("o1", "o3")):
                    model["model_type"] = "o-series"
                elif "deepseek" in model_id.lower():
                    model["model_type"] = "deepseek"
                else:
                    model["model_type"] = "standard"

            # Validate API version format
            api_version = model.get("api_version")
            if api_version and not re.match(
                r"^\d{4}-\d{2}-\d{2}(|-preview|-alpha\d+)$", api_version
            ):
                raise ValueError(f"Invalid API version format: {api_version}")

            # Ensure required fields based on model type
            model_type = model.get("model_type") or model.get("type", "standard")
            if model_type == "o-series" and "reasoning_effort" not in model:
                model["reasoning_effort"] = "medium"
                model["requires_reasoning_effort"] = True

            if model_type == "deepseek" and "enable_thinking" not in model:
                model["enable_thinking"] = True

        except ValueError as ve:
            raise HTTPException(
                status_code=422, detail=f"Invalid model configuration: {str(ve)}"
            )

        # Add to client pool
        success = await client_pool.add_or_update_model(
            actual_model_id, model, db_session
        )

        if not success:
            raise HTTPException(
                status_code=500, detail=f"Failed to create model {actual_model_id}"
            )

        return {
            "status": "created",
            "model_id": actual_model_id,
            "model_type": model.get("model_type", "standard"),
        }
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
    db_session: AsyncSession = Depends(get_db_session),
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
            model_id, model.model_dump(), db_session
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
    model_id: str, db_session: AsyncSession = Depends(get_db_session)
):
    """Delete a model configuration"""
    try:
        # Get client pool
        client_pool = await get_client_pool(db_session)

        # Prevent deleting the default model
        if model_id == app_config.AZURE_OPENAI_DEPLOYMENT_NAME:
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


# ==================================================================================
# Model Switching Endpoints
# ==================================================================================

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

        # Check for model aliases and normalize model_id
        model_id = MODEL_ALIASES.get(model_id.lower(), model_id)
        
        # Get client pool
        client_pool = await get_client_pool(db_session)

        # Verify model exists
        model_config = client_pool.get_model_config(model_id)
        if not model_config:
            # Try to create it if it's a known model type
            model_id_lower = model_id.lower()
            if model_id_lower == "deepseek-r1" or model_id_lower == "o1":
                model_template = ModelRegistry.get_model_template(model_id)
                await client_pool.add_or_update_model(
                    model_id, model_template, db_session
                )
                model_config = client_pool.get_model_config(model_id)
            else:
                raise HTTPException(
                    status_code=404, detail=f"Model {model_id} not found"
                )

        # Validate model configuration
        if not model_config or not model_config.get("api_version"):
            raise HTTPException(
                status_code=422,
                detail="Invalid model configuration: Missing API version"
            )

        # Handle session operations if session_id is provided
        if session_id:
            try:
                # Validate UUID format
                session_uuid = uuid.UUID(session_id)
                
                # Get current model using SessionService
                current_model = await SessionService.get_current_model(
                    session_id=session_uuid,
                    db_session=db_session
                )

                # Handle model-specific parameter transitions
                if current_model is not None and str(current_model) != str(model_id):
                    # Fetch the old_config using the current_model value
                    old_config = client_pool.get_model_config(str(current_model)) or {}
                    old_type = old_config.get("model_type", "standard")
                    new_type = model_config.get("model_type", "standard")

                    if old_type != new_type:
                        logger.info(f"Switching model types from {old_type} to {new_type}")
                        # Model-specific transition logic would go here

                # Update the session using SessionService
                success, error = await SessionService.switch_model(
                    session_id=session_uuid,
                    new_model=model_id,
                    db_session=db_session
                )
                
                if not success:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to update session model: {error or 'Unknown error'}"
                    )
            except ValueError:
                raise HTTPException(
                    status_code=400, detail=f"Invalid session ID format: {session_id}"
                )

        # Make sure model_config is not None before calling get method
        if model_config is None:
            model_config = {}
            
        return {
            "success": True,
            "model": model_id,
            "api_version": model_config.get("api_version"),
            "model_type": model_config.get("model_type", "standard"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error switching model to {request.model_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error switching model: {str(e)}")


@router.post("/models/switch_model/{model_id}")
async def switch_model_path(
    model_id: str,
    session_id: str = Query(..., description="Session ID query param"),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Switch model using path parameter for model ID and query parameter for session ID"""
    try:
        if not model_id:
            raise HTTPException(status_code=400, detail="Model ID is required")

        # Check for model aliases
        actual_model_id = MODEL_ALIASES.get(model_id.lower(), model_id)

        if actual_model_id != model_id:
            logger.info(f"Using {actual_model_id} as fallback for {model_id}")
            model_id = actual_model_id

        # Get client pool
        client_pool = await get_client_pool(db_session)

        # Verify model exists
        model_config = client_pool.get_model_config(model_id)
        if not model_config:
            # Try to create it if it's a known model type
            if model_id.lower() == "deepseek-r1" or model_id.lower() == "o1":
                model_template = ModelRegistry.get_model_template(model_id)
                await client_pool.add_or_update_model(
                    model_id, model_template, db_session
                )
            else:
                raise HTTPException(
                    status_code=404, detail=f"Model {model_id} not found"
                )

        # Validate session ID
        if not session_id:
            raise HTTPException(status_code=400, detail="Session ID is required")

        # Validate UUID format
        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"Invalid session ID format: {session_id}"
            )

        # Update the session model using SessionService
        success, error = await SessionService.switch_model(
            session_id=session_uuid,
            new_model=model_id,
            db_session=db_session
        )

        if not success:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to update session {session_id}: {error or 'Unknown error'}"
            )

        return {"success": True, "model": model_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error switching model to {model_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error switching model: {str(e)}")


# ==================================================================================
# Debug Endpoints
# ==================================================================================

@router.get("/models/debug", tags=["debug"])
async def debug_models(db_session: AsyncSession = Depends(get_db_session)):
    """Debug endpoint to check model configurations"""
    try:
        # Get client pool
        client_pool = await get_client_pool(db_session)

        # Get raw config from config service
        config_service = ConfigService(db_session)
        raw_config = await config_service.get_config("model_configs")

        return {
            "status": "ok",
            "client_pool_models": client_pool.get_all_models(),
            "db_models": raw_config,
            "env_defaults": {
                "AZURE_OPENAI_ENDPOINT": app_config.AZURE_OPENAI_ENDPOINT,
                "AZURE_INFERENCE_ENDPOINT": app_config.AZURE_INFERENCE_ENDPOINT,
                "default_model": app_config.AZURE_OPENAI_DEPLOYMENT_NAME,
            },
        }
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}
