from typing import Any, Dict, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from logging_config import logger
from database import get_db_session
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
        """Get configuration value by key"""
        try:
            result = await self.db.execute(
                select(AppConfiguration).where(AppConfiguration.key == key)
            )
            config_obj = result.scalar_one_or_none()
            
            # Early exit if no configuration found
            if config_obj is None:
                return None
                
            # Extract the actual Python value from the model instance
            if hasattr(config_obj, "value") and config_obj.value is not None:
                # Use dict() to ensure we're returning a proper dictionary
                return dict(config_obj.value) if isinstance(config_obj.value, dict) else {}
            return {}
            
        except Exception as e:
            logger.error(f"Error retrieving configuration for key {key}: {str(e)}")
            return None

    async def set_config(
        self,
        key: str,
        value: Dict[str, Any],
        description: Optional[str] = None,
        is_secret: bool = False,
    ) -> bool:
        """Set configuration value using upsert"""
        try:
            # Use upsert operation with PostgreSQL syntax
            from sqlalchemy.dialects.postgresql import insert
            insert_stmt = insert(AppConfiguration).values(
                key=key,
                value=value,
                description=description,
                is_secret=is_secret
            )
            update_stmt = insert_stmt.on_conflict_do_update(
                index_elements=['key'],
                set_={
                    'value': value,
                    'description': description,
                    'is_secret': is_secret,
                    'updated_at': func.now()
                }
            )
            await self.db.execute(update_stmt)
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


def get_config_service(db=Depends(get_db_session)):
    """
    Return a ConfigService instance with correct database session.
    """
    return ConfigService(db)