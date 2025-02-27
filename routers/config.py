import config
import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

from services.config_service import get_config_service, ConfigService
from pydantic import BaseModel, Field, validator
from clients import get_client_pool, ClientPool
from database import AsyncSessionLocal

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
    supports_streaming: Optional[bool] = False
    supports_temperature: Optional[bool] = False
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
        print("DEBUG: Starting get_models endpoint")
        models = await config_service.get_model_configs()
        print(f"DEBUG: Retrieved models from config_service: {models}")

        # If models is None or empty, create default models
        if not models:
            print("DEBUG: No models found, creating defaults")
            models = {
                "o1hp": {
                    "name": "o1hp",
                    "description": "Azure OpenAI o1 high performance model",
                    "max_tokens": 40000,
                    "supports_streaming": False,
                    "supports_temperature": False,
                    "api_version": config.AZURE_OPENAI_API_VERSION,
                    "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                    "base_timeout": 120.0,
                    "max_timeout": 300.0,
                    "token_factor": 0.05,
                },
                "DeepSeek-R1": {
                    "name": "DeepSeek-R1",
                    "description": "Model that supports chain-of-thought reasoning with <think> tags",
                    "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                    "api_version": config.AZURE_INFERENCE_API_VERSION,
                    "max_tokens": 32000,
                    "supports_streaming": True,
                    "supports_temperature": True,
                    "base_timeout": 120.0,
                    "max_timeout": 300.0,
                    "token_factor": 0.05,
                },
            }
            # Save default models to database
            await config_service.set_config(
                "model_configs", models, "Default model configurations", is_secret=True
            )
            print(f"DEBUG: Created and saved default models: {list(models.keys())}")
        else:
            # Check if DeepSeek-R1 exists, if not add it
            if "DeepSeek-R1" not in models:
                print("DEBUG: Adding missing DeepSeek-R1 to models")
                models["DeepSeek-R1"] = {
                    "name": "DeepSeek-R1",
                    "description": "Model that supports chain-of-thought reasoning with <think> tags",
                    "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                    "api_version": config.AZURE_INFERENCE_API_VERSION,
                    "max_tokens": 32000,
                    "supports_streaming": True,
                    "supports_temperature": True,
                    "base_timeout": 120.0,
                    "max_timeout": 300.0,
                    "token_factor": 0.05,
                }
                # Save updated models to database
                await config_service.set_config(
                    "model_configs",
                    models,
                    "Updated with DeepSeek-R1 model",
                    is_secret=True,
                )
                print("DEBUG: Saved models with added DeepSeek-R1")

            # Check if o1hp exists, if not add it
            if "o1hp" not in models:
                print("DEBUG: Adding missing o1hp to models")
                models["o1hp"] = {
                    "name": "o1hp",
                    "description": "Azure OpenAI o1 high performance model",
                    "max_tokens": 40000,
                    "supports_streaming": False,
                    "supports_temperature": False,
                    "api_version": config.AZURE_OPENAI_API_VERSION,
                    "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                    "base_timeout": 120.0,
                    "max_timeout": 300.0,
                    "token_factor": 0.05,
                }
                # Save updated models to database
                await config_service.set_config(
                    "model_configs", models, "Updated with o1hp model", is_secret=True
                )
                print("DEBUG: Saved models with added o1hp")

        print(f"DEBUG: Returning models: {list(models.keys())}")
        return models

    except Exception as e:
        print(f"ERROR in get_models: {str(e)}")
        logger.error(f"Error in get_models: {str(e)}")

        # Instead of raising an exception, return default models
        default_models = {
            "o1hp": {
                "name": "o1hp",
                "description": "Azure OpenAI o1 high performance model",
                "max_tokens": 40000,
                "supports_streaming": False,
                "supports_temperature": False,
                "api_version": config.AZURE_OPENAI_API_VERSION,
                "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
            },
            "DeepSeek-R1": {
                "name": "DeepSeek-R1",
                "description": "Model that supports chain-of-thought reasoning with <think> tags",
                "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                "api_version": config.AZURE_INFERENCE_API_VERSION,
                "max_tokens": 32000,
                "supports_streaming": True,
                "supports_temperature": True,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
            },
        }
        print(
            f"DEBUG: Returning default models due to error: {list(default_models.keys())}"
        )
        return default_models


@router.get("/models/{model_id}", response_model=None)
async def get_model(model_id: str, config_service=Depends(get_config_service)):
    """Get a specific model configuration"""
    try:
        # First check if the model exists in the configs
        model_configs = await config_service.get_model_configs()

        if model_id in model_configs:
            return model_configs[model_id]

        # If not in configs but is a known model, create it
        if model_id == "DeepSeek-R1":
            logger.info(f"Auto-creating DeepSeek-R1 model configuration")
            deepseek_config = {
                "name": "DeepSeek-R1",
                "description": "Model that supports chain-of-thought reasoning with <think> tags",
                "max_tokens": config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
                "supports_streaming": True,
                "supports_temperature": True,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
                "api_version": config.AZURE_INFERENCE_API_VERSION,
                "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
            }

            success = await config_service.add_model_config(model_id, deepseek_config)
            if success:
                return deepseek_config

        elif model_id == "o1hp" or (
            model_id.startswith("o1")
            and model_id.lower() == config.AZURE_OPENAI_DEPLOYMENT_NAME.lower()
        ):
            logger.info(f"Auto-creating {model_id} model configuration")
            o1_config = {
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

            success = await config_service.add_model_config(model_id, o1_config)
            if success:
                return o1_config

        # If we get here, the model doesn't exist and isn't a known type
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
            if model_id == "DeepSeek-R1":
                model = {
                    "name": "DeepSeek-R1",
                    "description": "Model that supports chain-of-thought reasoning with <think> tags",
                    "max_tokens": 32000,
                    "supports_streaming": True,  # Explicitly enable streaming for DeepSeek-R1
                    "supports_temperature": True,
                    "api_version": config.AZURE_INFERENCE_API_VERSION,
                    "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                    "base_timeout": 120.0,
                    "max_timeout": 300.0,
                    "token_factor": 0.05,
                }
            elif model_id == "o1hp" or model_id.startswith("o1"):
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

        # Default streaming to True for DeepSeek-R1 if not provided
        if model_id.lower() == "deepseek-r1":
            model.setdefault("supports_streaming", True)
            model.setdefault("supports_temperature", True)
            
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


@router.post("/models/switch_model/{model_id}")
async def switch_model_simple(
    model_id: str,
    session_id: Optional[str] = None,
    client_pool: ClientPool = Depends(get_client_pool),
    config_service: ConfigService = Depends(get_config_service),
):
    """Switch the active model for the current session - simplified endpoint"""
    print(
        f"DEBUG - switch_model_simple called with model_id={model_id}, session_id={session_id}"
    )

    if not model_id or model_id == "models":  # Prevent the "models" error
        raise HTTPException(status_code=400, detail="Valid model ID is required")

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
            "description": "Model that supports chain-of-thought reasoning with <think> tags",
        }
        success = await config_service.add_model_config(model_id, deepseek_config)
        if not success:
            raise HTTPException(
                status_code=500, detail="Failed to create DeepSeek-R1 model"
            )
        model_configs = await config_service.get_model_configs()

    # For o1hp, create it if needed
    if model_id == "o1hp" and model_id not in model_configs:
        print("Creating o1hp model in configs")
        o1_config = {
            "name": "o1hp",
            "description": "Advanced reasoning model for complex tasks",
            "max_tokens": 200000,
            "supports_temperature": False,
            "supports_streaming": False,
            "supports_vision": True,
            "requires_reasoning_effort": True,
            "base_timeout": 120.0,
            "max_timeout": 300.0,
            "token_factor": 0.05,
            "api_version": config.AZURE_OPENAI_API_VERSION,
            "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
        }
        success = await config_service.add_model_config(model_id, o1_config)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create o1hp model")
        model_configs = await config_service.get_model_configs()

    if model_id not in model_configs:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    # Store the selected model in the session
    if session_id:
        from database import AsyncSessionLocal
        from sqlalchemy import update
        from models import Session

        async with AsyncSessionLocal() as db_session:
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

    # Optionally refresh the client for this model
    try:
        await client_pool.refresh_client(model_id, config_service)
    except Exception as e:
        logger.warning(f"Could not refresh client for {model_id}: {str(e)}")
        # Continue even if refresh fails - don't block model switching

    return {"success": True, "model": model_id}


@router.get("/models/debug", tags=["debug"])
async def debug_models(config_service=Depends(get_config_service)):
    """Debug endpoint to check model configurations"""
    try:
        # Get raw configs without processing
        raw_config = await config_service.get_config("model_configs")

        # Get database connection status
        db_status = "Connected" if config_service.db else "Not Connected"

        return {
            "status": "ok",
            "db_connection": db_status,
            "raw_configs": raw_config,
            "env_defaults": {
                "AZURE_OPENAI_ENDPOINT": config.AZURE_OPENAI_ENDPOINT,
                "AZURE_INFERENCE_ENDPOINT": config.AZURE_INFERENCE_ENDPOINT,
                "default_model": config.AZURE_OPENAI_DEPLOYMENT_NAME,
            },
        }
    except Exception as e:
        import traceback

        return {"status": "error", "error": str(e), "traceback": traceback.format_exc()}
