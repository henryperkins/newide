from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db_session
from fastapi import Depends
from typing import Any, Dict
import json
from sqlalchemy import text

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

    async def set_config(self, key: str, value: Any, description: str = "", is_secret: bool = False):
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
                "value": json.dumps(value),
                "description": description,
                "is_secret": is_secret
            }
        )
        await self.db.commit()

    async def get_all_configs(self) -> Dict[str, Any]:
        result = await self.db.execute(
            text("SELECT key, value FROM app_configurations WHERE is_secret = false")
        )
        return {row.key: json.loads(row.value) for row in result.fetchall()}
