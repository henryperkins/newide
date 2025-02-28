from typing import Any, Dict, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from logging_config import logger
from database import get_db_session  # For injection
from models import AppConfiguration
from fastapi import Depends
import os
import json
import time
from functools import lru_cache

# Global cache variables
_model_configs_cache = {}
_model_configs_timestamp = 0
_cache_ttl = 300  # 5 minutes

# Default model configurations based on documentation
DEFAULT_MODEL_CONFIGS = {
    "o1hp": {
        "name": "o1hp",
        "description": "Advanced reasoning model for complex tasks",
        "max_tokens": 200000,  # Input token limit from docs
        "max_completion_tokens": 5000,  # From docs
        "supports_temperature": False,  # o1 doesn't support temperature
        "supports_streaming": False,  # o1 doesn't support streaming
        "supports_vision": True,  # o1 supports vision
        "requires_reasoning_effort": True,
        "reasoning_effort": "medium",
        "base_timeout": 120.0,
        "max_timeout": 300.0,
        "token_factor": 0.05,
        "api_version": os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview"),
        "azure_endpoint": os.getenv("AZURE_OPENAI_ENDPOINT", "")
    },
    "DeepSeek-R1": {
        "name": "DeepSeek-R1",
        "description": "Model that supports chain-of-thought reasoning with <think> tags",
        "max_tokens": 32000,  # From docs
        "supports_streaming": True,
        "supports_temperature": True,
        "api_version": os.getenv("AZURE_INFERENCE_API_VERSION", "2024-05-01-preview"),
        "azure_endpoint": os.getenv("AZURE_INFERENCE_ENDPOINT", ""),
        "base_timeout": 120.0,
        "max_timeout": 300.0,
        "token_factor": 0.05
    }
}

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
            
            # Invalidate cache if model_configs is updated
            if key == "model_configs":
                global _model_configs_cache, _model_configs_timestamp
                _model_configs_cache = {}
                _model_configs_timestamp = 0
                
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
            
            # Invalidate cache if model_configs is deleted
            if key == "model_configs":
                global _model_configs_cache, _model_configs_timestamp
                _model_configs_cache = {}
                _model_configs_timestamp = 0
                
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
        """
        Get all model configurations with caching for better performance.
        Uses defaults from documentation if database retrieval fails.
        """
        global _model_configs_cache, _model_configs_timestamp
        
        # Check if we have a recent cache
        current_time = time.time()
        if _model_configs_cache and (current_time - _model_configs_timestamp) < _cache_ttl:
            logger.debug("Using cached model configurations")
            return _model_configs_cache
        
        try:
            # Fetch from database
            db_models = await self.get_config("model_configs") or {}
            model_configs = db_models.copy()
            
            # If empty, use defaults from documentation
            if not model_configs:
                logger.warning("No model configurations found in the database. Using defaults.")
                model_configs = DEFAULT_MODEL_CONFIGS.copy()
                
                # Try to save defaults to database
                await self.set_config(
                    "model_configs", 
                    model_configs, 
                    "Default model configurations based on documentation", 
                    is_secret=True
                )
            
            # Ensure required models exist
            self._ensure_required_models(model_configs)
            
            # Update cache
            _model_configs_cache = model_configs
            _model_configs_timestamp = current_time
            
            return model_configs
        except Exception as e:
            logger.error(f"Error fetching model_configs: {str(e)}")
            
            # If we have a cache, use it even if stale
            if _model_configs_cache:
                logger.warning("Using stale cache for model configurations")
                return _model_configs_cache
            
            # Otherwise fall back to defaults
            logger.warning("Falling back to default model configurations")
            return DEFAULT_MODEL_CONFIGS.copy()

    def _ensure_required_models(self, model_configs: Dict[str, Any]) -> None:
        """
        Ensure that required models exist in the configuration with proper settings.
        """
        # Ensure o1hp exists
        if "o1hp" not in model_configs:
            model_configs["o1hp"] = DEFAULT_MODEL_CONFIGS["o1hp"]
        else:
            # Ensure o1hp has required fields
            for field, value in DEFAULT_MODEL_CONFIGS["o1hp"].items():
                if field not in model_configs["o1hp"]:
                    model_configs["o1hp"][field] = value
                    
        # Ensure DeepSeek-R1 exists
        if "DeepSeek-R1" not in model_configs:
            model_configs["DeepSeek-R1"] = DEFAULT_MODEL_CONFIGS["DeepSeek-R1"]
        else:
            # Ensure DeepSeek-R1 has required fields
            for field, value in DEFAULT_MODEL_CONFIGS["DeepSeek-R1"].items():
                if field not in model_configs["DeepSeek-R1"]:
                    model_configs["DeepSeek-R1"][field] = value

    async def add_model_config(self, model_id: str, model_config: Dict[str, Any]) -> bool:
        """Add a new model configuration"""
        models = await self.get_model_configs()
        if model_id in models:
            return False
            
        # Apply model-specific configurations and ensure required fields
        if model_id.lower().startswith("o1") and "max_completion_tokens" not in model_config:
            # Apply o-series specific defaults
            for field, value in DEFAULT_MODEL_CONFIGS["o1hp"].items():
                if field not in model_config:
                    model_config[field] = value
        elif model_id.lower() == "deepseek-r1" and "max_tokens" not in model_config:
            # Apply DeepSeek specific defaults
            for field, value in DEFAULT_MODEL_CONFIGS["DeepSeek-R1"].items():
                if field not in model_config:
                    model_config[field] = value
                
        # Add to models
        models[model_id] = model_config
        return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

    async def update_model_config(self, model_id: str, model_config: Dict[str, Any]) -> bool:
        """Update an existing model configuration"""
        models = await self.get_model_configs()
        if model_id not in models:
            return False
            
        # Merge with existing config
        existing_config = models[model_id]
        updated_config = {**existing_config, **model_config}
        
        # Ensure model-specific required fields are maintained
        if model_id.lower().startswith("o1"):
            updated_config["requires_reasoning_effort"] = True
            
        models[model_id] = updated_config
        return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

    async def delete_model_config(self, model_id: str) -> bool:
        """Delete a model configuration"""
        models = await self.get_model_configs()
        if model_id not in models:
            return False
            
        # Prevent deleting core models
        if model_id in DEFAULT_MODEL_CONFIGS:
            logger.warning(f"Attempted to delete core model {model_id}. Marking as inactive instead.")
            models[model_id]["active"] = False
            return await self.set_config("model_configs", models, "Model configurations", is_secret=True)
            
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