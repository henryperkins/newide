from typing import Any, Dict, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from logging_config import logger
from database import get_db_session  # For injection
from models import AppConfiguration
from fastapi import Depends
import config  # Add this import

class ConfigService:
    """
    Service to manage application configurations stored in the database.
    Each configuration is an AppConfiguration row, keyed by a unique 'key' column.
    """
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_config(self, key: str) -> Optional[Dict[str, Any]]:
        try:
            result = await self.db.execute(
                select(AppConfiguration).where(AppConfiguration.key == key)
            )
            config = result.scalar_one_or_none()
            return config.value if config else None
        except Exception as e:
            logger.error(f"Error fetching config for key '{key}': {str(e)}")
            return None

    async def set_config(
        self,
        key: str,
        value: Dict[str, Any],
        description: Optional[str] = None,
        is_secret: bool = False,
    ) -> bool:
        try:
            # Check if the key already exists
            existing_config = await self.get_config(key)
            if existing_config is not None:
                # Update existing config
                await self.db.execute(
                    update(AppConfiguration)
                    .where(AppConfiguration.key == key)
                    .values(value=value, description=description, is_secret=is_secret)
                )
                logger.info(f"Updated config for key '{key}'")
            else:
                # Insert new config
                new_config = AppConfiguration(
                    key=key,
                    value=value,
                    description=description,
                    is_secret=is_secret,
                )
                self.db.add(new_config)
                logger.info(f"Inserted config for key '{key}'")

            await self.db.commit()
            return True
        except Exception as e:
            logger.error(f"Error setting config for key '{key}': {str(e)}")
            await self.db.rollback()
            return False

    async def delete_config(self, key: str) -> bool:
        try:
            await self.db.execute(
                delete(AppConfiguration).where(AppConfiguration.key == key)
            )
            await self.db.commit()
            logger.info(f"Deleted config for key '{key}'")
            return True
        except Exception as e:
            logger.error(f"Error deleting config for key '{key}': {str(e)}")
            await self.db.rollback()
            return False

    async def list_configs(self) -> List[AppConfiguration]:
        try:
            result = await self.db.execute(select(AppConfiguration))
            configs = result.scalars().all()
            return list(configs)
        except Exception as e:
            logger.error(f"Error listing configs: {str(e)}")
            await self.db.rollback()
            return []
            
    async def get_model_configs(self) -> Dict[str, Any]:
        """Get all model configurations"""
        db_models = (await self.get_config("model_configs")) or {}
        
        # Ensure DeepSeek-R1 exists with correct casing
        deepseek_key = next((k for k in db_models.keys() if k.lower() == 'deepseek-r1'), None)
        if not deepseek_key:
            db_models["DeepSeek-R1"] = {
                "name": "DeepSeek-R1",
                "description": "Model that supports chain-of-thought reasoning with <think> tags",
                "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
                "api_version": config.AZURE_INFERENCE_API_VERSION,
                "max_tokens": config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS,
                "supports_temperature": True,
                "supports_streaming": True,  # Explicitly enable streaming for DeepSeek-R1
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05
            }
            await self.set_config("model_configs", db_models, "Model configurations", is_secret=True)
        elif deepseek_key != "DeepSeek-R1":
            # Fix casing if needed
            db_models["DeepSeek-R1"] = db_models.pop(deepseek_key)
            await self.set_config("model_configs", db_models, "Model configurations", is_secret=True)
        
        # Ensure o1 models exist with proper configuration
        default_o1 = config.AZURE_OPENAI_DEPLOYMENT_NAME
        if default_o1 not in db_models and default_o1.startswith("o1"):
            db_models[default_o1] = {
                "name": default_o1,
                "description": "Azure OpenAI o1 model for advanced reasoning",
                "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                "api_version": config.AZURE_OPENAI_API_VERSION,
                "max_tokens": config.O_SERIES_INPUT_TOKEN_LIMIT,
                "max_completion_tokens": config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS,
                "requires_reasoning_effort": True,
                "reasoning_effort": config.O_SERIES_DEFAULT_REASONING_EFFORT,
                "supports_temperature": False,
                "supports_streaming": False
            }
            await self.set_config("model_configs", db_models, "Model configurations with o1", is_secret=True)
        
        # Ensure all models have required fields
        for model_id, model_config in db_models.items():
            if "name" not in model_config:
                model_config["name"] = model_id
            if "description" not in model_config:
                model_config["description"] = f"Model configuration for {model_id}"
            if "max_tokens" not in model_config:
                model_config["max_tokens"] = 4096
            if "supports_streaming" not in model_config:
                model_config["supports_streaming"] = False
            if "supports_temperature" not in model_config:
                model_config["supports_temperature"] = False
            if "azure_endpoint" not in model_config:
                if config.is_deepseek_model(model_id):
                    model_config["azure_endpoint"] = config.AZURE_INFERENCE_ENDPOINT
                else:
                    model_config["azure_endpoint"] = config.AZURE_OPENAI_ENDPOINT
            if "api_version" not in model_config:
                if config.is_deepseek_model(model_id):
                    model_config["api_version"] = config.AZURE_INFERENCE_API_VERSION
                else:
                    model_config["api_version"] = config.AZURE_OPENAI_API_VERSION
                
            # Add o-series specific fields
            if config.is_o_series_model(model_id):
                if "max_completion_tokens" not in model_config:
                    model_config["max_completion_tokens"] = config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
                if "requires_reasoning_effort" not in model_config:
                    model_config["requires_reasoning_effort"] = True
                if "reasoning_effort" not in model_config:
                    model_config["reasoning_effort"] = config.O_SERIES_DEFAULT_REASONING_EFFORT
                if "max_tokens" not in model_config or model_config["max_tokens"] < 100000:
                    model_config["max_tokens"] = config.O_SERIES_INPUT_TOKEN_LIMIT
                
                # o-series models don't support temperature
                model_config["supports_temperature"] = False
                model_config["supports_streaming"] = False
            
            # DeepSeek-R1 specific fields
            if config.is_deepseek_model(model_id):
                if "max_tokens" not in model_config or model_config["max_tokens"] != config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS:
                    model_config["max_tokens"] = config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
                model_config["supports_temperature"] = True
                model_config["supports_streaming"] = True  # Always ensure streaming is enabled for DeepSeek-R1
                model_config["api_version"] = config.DEEPSEEK_R1_DEFAULT_API_VERSION
                
        return db_models

    async def add_model_config(self, model_id: str, model_config: Dict[str, Any]) -> bool:
        """Add a new model configuration"""
        models = await self.get_model_configs()
        
        # Case-insensitive check for existing models
        existing_model_id = next(
            (k for k in models.keys() if k.lower() == model_id.lower()), 
            None
        )
        
        if existing_model_id:
            logger.info(f"Model {model_id} already exists as {existing_model_id}")
            return True  # Consider it a success if model already exists
            
        # Apply model-specific configurations
        if config.is_o_series_model(model_id) and "max_completion_tokens" not in model_config:
            model_config["max_completion_tokens"] = config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
            model_config["requires_reasoning_effort"] = True
            model_config["reasoning_effort"] = config.O_SERIES_DEFAULT_REASONING_EFFORT
            model_config["supports_streaming"] = False
            
        # Ensure all required fields are set
        required_fields = {
            'name', 'max_tokens', 'supports_streaming',
            'supports_temperature', 'api_version', 'azure_endpoint'
        }
        
        # Add default values for missing required fields
        if "name" not in model_config:
            model_config["name"] = model_id
        if "azure_endpoint" not in model_config:
            if config.is_deepseek_model(model_id):
                model_config["azure_endpoint"] = config.AZURE_INFERENCE_ENDPOINT
            else:
                model_config["azure_endpoint"] = config.AZURE_OPENAI_ENDPOINT
        if "api_version" not in model_config:
            if config.is_deepseek_model(model_id):
                model_config["api_version"] = config.AZURE_INFERENCE_API_VERSION
            else:
                model_config["api_version"] = config.AZURE_OPENAI_API_VERSION
        if "max_tokens" not in model_config:
            if config.is_deepseek_model(model_id):
                model_config["max_tokens"] = config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
            else:
                model_config["max_tokens"] = 4096
        if "supports_streaming" not in model_config:
            model_config["supports_streaming"] = config.is_deepseek_model(model_id)
        if "supports_temperature" not in model_config:
            model_config["supports_temperature"] = config.is_deepseek_model(model_id)
        
        # Add required numeric fields with defaults and ensure they're numbers
        for field, default in [
            ("base_timeout", 120.0),
            ("max_timeout", 300.0),
            ("token_factor", 0.05),
            ("max_tokens", 4096)
        ]:
            if field not in model_config:
                model_config[field] = default
            else:
                # Ensure numeric fields are actually numbers
                try:
                    model_config[field] = float(model_config[field])
                except (ValueError, TypeError):
                    logger.warning(f"Converting {field} from {type(model_config[field])} to float")
                    model_config[field] = default
                
        # Add to models
        models[model_id] = model_config
        return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

    async def update_model_config(self, model_id: str, model_config: Dict[str, Any]) -> bool:
        """Update an existing model configuration"""
        models = await self.get_model_configs()
        if model_id not in models:
            return False
            
        # Apply model-specific configurations
        if config.is_o_series_model(model_id) and "max_completion_tokens" not in model_config:
            model_config["max_completion_tokens"] = config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS
            model_config["requires_reasoning_effort"] = True
            model_config["reasoning_effort"] = config.O_SERIES_DEFAULT_REASONING_EFFORT
        
        # Ensure required numeric fields are present
        if "base_timeout" not in model_config:
            model_config["base_timeout"] = 120.0
        if "max_timeout" not in model_config:
            model_config["max_timeout"] = 300.0
        if "token_factor" not in model_config:
            model_config["token_factor"] = 0.05
            
        # Preserve existing values for required fields if not provided
        existing_config = models[model_id]
        for field in ['name', 'max_tokens', 'supports_streaming', 'supports_temperature', 'api_version', 'azure_endpoint']:
            if field not in model_config:
                model_config[field] = existing_config.get(field)
            
        models[model_id] = model_config
        return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

    async def delete_model_config(self, model_id: str) -> bool:
        """Delete a model configuration"""
        models = await self.get_model_configs()
        if model_id not in models:
            return False
        del models[model_id]
        return await self.set_config("model_configs", models, "Model configurations", is_secret=True)
        
    async def get_model_config(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific model configuration"""
        models = await self.get_model_configs()
        return models.get(model_id)

def get_config_service(db=Depends(get_db_session)):
    """
    Return a ConfigService instance without type hints in the signature.
    This ensures FastAPI won't treat AsyncSession as a Pydantic field.
    """
    return ConfigService(db)
