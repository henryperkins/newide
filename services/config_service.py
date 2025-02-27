from typing import Any, Dict, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from logging_config import logger
from database import get_db_session  # For injection
from models import AppConfiguration
from fastapi import Depends
import config  # Add this import
from clients import get_client_pool, ClientPool

class ConfigService:
    """
    Service to manage application configurations stored in the database.
    Each configuration is an AppConfiguration row, keyed by a unique 'key' column.
    """
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_config(self, key: str) -> Optional[Dict[str, Any]]:
        """Get configuration value by key"""
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
        """Set configuration value"""
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
        """Delete configuration by key"""
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
        """List all configurations"""
        try:
            result = await self.db.execute(select(AppConfiguration))
            configs = result.scalars().all()
            return list(configs)
        except Exception as e:
            logger.error(f"Error listing configs: {str(e)}")
            await self.db.rollback()
            return []
            
    # -------------------------------------------------------------------------
    # Model Configuration Methods
    # These methods now delegate to ClientPool for model management
    # -------------------------------------------------------------------------
    
    async def get_model_configs(self) -> Dict[str, Any]:
        """Get all model configurations"""
        # First try to get the pool to use its cached configurations
        try:
            pool = await get_client_pool(self.db)
            return pool.get_all_models()
        except Exception as e:
            logger.error(f"Error getting model configs from pool: {str(e)}")
            
        # Fall back to direct database access if pool access fails
        return await self.get_config("model_configs") or {}

    async def get_model_config(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a specific model"""
        try:
            pool = await get_client_pool(self.db)
            return pool.get_model_config(model_id)
        except Exception as e:
            logger.error(f"Error getting model config from pool: {str(e)}")
            
        # Fall back to direct lookup
        configs = await self.get_config("model_configs") or {}
        return configs.get(model_id)

    async def add_model_config(self, model_id: str, model_config: Dict[str, Any]) -> bool:
        """Add a new model configuration"""
        try:
            pool = await get_client_pool(self.db)
            return await pool.add_or_update_model(model_id, model_config, self.db)
        except Exception as e:
            logger.error(f"Error adding model config: {str(e)}")
            return False

    async def update_model_config(self, model_id: str, model_config: Dict[str, Any]) -> bool:
        """Update an existing model configuration"""
        try:
            pool = await get_client_pool(self.db)
            return await pool.add_or_update_model(model_id, model_config, self.db)
        except Exception as e:
            logger.error(f"Error updating model config: {str(e)}")
            return False

    async def delete_model_config(self, model_id: str) -> bool:
        """Delete a model configuration"""
        try:
            pool = await get_client_pool(self.db)
            return await pool.delete_model(model_id, self.db)
        except Exception as e:
            logger.error(f"Error deleting model config: {str(e)}")
            return False

def get_config_service(db=Depends(get_db_session)):
    """
    Return a ConfigService instance with correct database session.
    """
    return ConfigService(db)