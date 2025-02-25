from typing import Any, Dict, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from logging_config import logger
from database import get_db_session  # For injection
from models import AppConfiguration
from fastapi import Depends

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
        return await self.get_config("model_configs") or {}

    async def get_model_config(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a specific model"""
        models = await self.get_model_configs()
        return models.get(model_id)

    async def add_model_config(self, model_id: str, config: Dict[str, Any]) -> bool:
        """Add a new model configuration"""
        models = await self.get_model_configs()
        if model_id in models:
            return False
        models[model_id] = config
        return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

    async def update_model_config(self, model_id: str, config: Dict[str, Any]) -> bool:
        """Update an existing model configuration"""
        models = await self.get_model_configs()
        if model_id not in models:
            return False
        models[model_id] = config
        return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

    async def delete_model_config(self, model_id: str) -> bool:
        """Delete a model configuration"""
        models = await self.get_model_configs()
        if model_id not in models:
            return False
        del models[model_id]
        return await self.set_config("model_configs", models, "Model configurations", is_secret=True)

def get_config_service(db=Depends(get_db_session)):
    """
    Return a ConfigService instance without type hints in the signature.
    This ensures FastAPI won't treat AsyncSession as a Pydantic field.
    """
    return ConfigService(db)
