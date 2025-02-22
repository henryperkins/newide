from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from fastapi import Depends
from typing import Any, Dict
import json
from sqlalchemy import text
import os

class ConfigService:
    def __init__(self, db: AsyncSession = Depends(get_db_session)):
        self.db = db
        
    async def get_config(self, key: str) -> Any:
        result = await self.db.execute(
            text("SELECT value FROM app_configurations WHERE key = :key"),
            {"key": key}
        )
        row = result.fetchone()
        return json.loads(row[0]) if row else None
        
    async def get_all_configs(self) -> Dict[str, Any]:
        try:
            result = await self.db.execute(
                text("SELECT key, value FROM app_configurations WHERE is_secret = false")
            )
            configs = {}
            for row in result.fetchall():
                try:
                    # Add API version to configs
                    if row.key == "azure_openai_api_version":
                        configs[row.key] = os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")
                    # Ensure value is properly serialized
                    value = row.value
                    if isinstance(value, str):
                        configs[row.key] = json.loads(value)
                    else:
                        configs[row.key] = json.loads(json.dumps(value))
                except json.JSONDecodeError:
                    configs[row.key] = row.value
            return configs
        except Exception as e:
            raise Exception(f"Error fetching configs: {str(e)}")

    async def set_config(self, key: str, value: Any, description: str = "", is_secret: bool = False):
        # Ensure value is JSON serializable
        value_json = json.dumps(value)
        await self.db.execute(
            text("""
                INSERT INTO app_configurations (key, value, description, is_secret)
                VALUES (:key, :value, :description, :is_secret)
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value,
                    description = EXCLUDED.description,
                    is_secret = EXCLUDED.is_secret,
                    updated_at = NOW()
            """),
            {
                "key": key,
                "value": value_json,
                "description": description,
                "is_secret": is_secret
            }
        )
        await self.db.commit()