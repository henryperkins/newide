from typing import Dict, Any, Optional, List
from datetime import datetime
import uuid
import asyncio
import json
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import aiofiles

from models import ModelUsageStats

class ModelStatsService:
    def __init__(self, db_session: AsyncSession):
        self.db = db_session
        self._buffer = []
        self._buffer_lock = asyncio.Lock()
        self._fallback_dir = Path("./stats_fallback")
        self._fallback_dir.mkdir(exist_ok=True)

    async def record_usage(
        self,
        model: str,
        session_id: uuid.UUID,
        usage: Dict[str, Any],
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Record model usage statistics for a chat completion.
        
        Args:
            model: The name of the model used
            session_id: The session ID for this chat
            usage: Usage statistics from the model response
            metadata: Optional additional metadata to store
        """
        # Always record regardless of token count
        stats = ModelUsageStats(
            model=model,
            session_id=session_id,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            total_tokens=usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0),
            reasoning_tokens=usage.get("completion_tokens_details", {}).get("reasoning_tokens"),
            cached_tokens=usage.get("prompt_tokens_details", {}).get("cached_tokens", 0),
            active_tokens=usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0) - usage.get("prompt_tokens_details", {}).get("cached_tokens", 0),
            metadata=metadata
        )

        async with self._buffer_lock:
            self._buffer.append(stats)
            
        if len(self._buffer) >= 50:
            await self._flush_buffer()
            
            # Insert into database
            await self.db.execute(
                text("""
                    INSERT INTO model_usage_stats (
                        model,
                        session_id,
                        prompt_tokens,
                        completion_tokens,
                        total_tokens,
                        reasoning_tokens,
                        cached_tokens,
                        metadata,
                        timestamp
                    ) VALUES (
                        :model,
                        :session_id,
                        :prompt_tokens,
                        :completion_tokens,
                        :total_tokens,
                        :reasoning_tokens,
                        :cached_tokens,
                        COALESCE(:metadata, '{}'::jsonb),
                        :timestamp
                    )
                """),
                {
                    "model": stats.model,
                    "session_id": stats.session_id,
                    "prompt_tokens": stats.prompt_tokens,
                    "completion_tokens": stats.completion_tokens,
                    "total_tokens": stats.total_tokens,
                    "reasoning_tokens": stats.reasoning_tokens,
                    "cached_tokens": stats.cached_tokens,
                    "metadata": metadata,
                    "timestamp": datetime.utcnow()
                }
            )
            await self.db.commit()

        except Exception as e:
            await self.db.rollback()
            await self._persist_fallback(self._buffer)
            self._buffer.clear()
            raise Exception(f"Failed to record model usage stats: {str(e)}")

    async def _persist_fallback(self, batch):
        async with aiofiles.open(self._fallback_dir / "pending.json", "a") as f:
            await f.write(json.dumps([ob.__dict__ for ob in batch]) + "\n")
            
    async def startup(self):
        """Recover any fallback data on service start"""
        try:
            async with aiofiles.open(self._fallback_dir / "pending.json", "r") as f:
                async for line in f:
                    records = json.loads(line)
                    for rec in records:
                        await self.db.execute(
                            text("""
                                INSERT INTO model_usage_stats 
                                (model, session_id, prompt_tokens, completion_tokens, total_tokens, 
                                 reasoning_tokens, cached_tokens, metadata, timestamp)
                                VALUES 
                                (:model, :session_id, :prompt_tokens, :completion_tokens, :total_tokens,
                                 :reasoning_tokens, :cached_tokens, :metadata, :timestamp)
                            """),
                            rec
                        )
            (self._fallback_dir / "pending.json").unlink()
        except FileNotFoundError:
            pass

    async def get_session_stats(
        self,
        session_id: uuid.UUID,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get usage statistics for a specific session.
        
        Args:
            session_id: The session ID to get stats for
            model: Optional model name to filter by
        
        Returns:
            Dictionary containing aggregated usage statistics
        """
        try:
            query = """
                SELECT 
                    model,
                    SUM(prompt_tokens) as total_prompt_tokens,
                    SUM(completion_tokens) as total_completion_tokens,
                    SUM(total_tokens) as total_tokens,
                    SUM(reasoning_tokens) as total_reasoning_tokens,
                    SUM(cached_tokens) as total_cached_tokens,
                    COUNT(*) as request_count
                FROM model_usage_stats
                WHERE session_id = :session_id
            """
            
            if model:
                query += " AND model = :model"
            
            query += " GROUP BY model"

            result = await self.db.execute(
                text(query),
                {
                    "session_id": session_id,
                    "model": model
                }
            )
            
            stats = {}
            for row in result.mappings():
                model_name = row["model"]
                stats[model_name] = {
                    "prompt_tokens": row["total_prompt_tokens"],
                    "completion_tokens": row["total_completion_tokens"],
                    "total_tokens": row["total_tokens"],
                    "reasoning_tokens": row["total_reasoning_tokens"],
                    "cached_tokens": row["total_cached_tokens"],
                    "request_count": row["request_count"]
                }
            
            return stats

        except Exception as e:
            raise Exception(f"Failed to get session stats: {str(e)}")

    async def get_model_stats(
        self,
        model: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Get usage statistics for a specific model.
        
        Args:
            model: The model name to get stats for
            start_time: Optional start time for the stats period
            end_time: Optional end time for the stats period
        
        Returns:
            Dictionary containing aggregated usage statistics
        """
        try:
            params = {"model": model}
            query = """
                SELECT 
                    SUM(prompt_tokens) as total_prompt_tokens,
                    SUM(completion_tokens) as total_completion_tokens,
                    SUM(total_tokens) as total_tokens,
                    SUM(reasoning_tokens) as total_reasoning_tokens,
                    SUM(cached_tokens) as total_cached_tokens,
                    COUNT(DISTINCT session_id) as unique_sessions,
                    COUNT(*) as request_count
                FROM model_usage_stats
                WHERE model = :model
            """

            if start_time:
                query += " AND timestamp >= :start_time"
                params["start_time"] = start_time

            if end_time:
                query += " AND timestamp <= :end_time"
                params["end_time"] = end_time

            result = await self.db.execute(text(query), params)
            row = result.mappings().first()

            if not row:
                return {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "reasoning_tokens": 0,
                    "cached_tokens": 0,
                    "unique_sessions": 0,
                    "request_count": 0
                }

            return {
                "prompt_tokens": row["total_prompt_tokens"],
                "completion_tokens": row["total_completion_tokens"],
                "total_tokens": row["total_tokens"],
                "reasoning_tokens": row["total_reasoning_tokens"],
                "cached_tokens": row["total_cached_tokens"],
                "unique_sessions": row["unique_sessions"],
                "request_count": row["request_count"]
            }

        except Exception as e:
            raise Exception(f"Failed to get model stats: {str(e)}")

    async def get_connection_stats(self) -> Dict[str, Any]:
        """
        Get connection statistics including:
        - Concurrent active connections
        - Recent connection attempts
        - Connection trends
        """
        try:
            # Get concurrent connections (active in last 5 minutes)
            concurrent_result = await self.db.execute(
                text("""
                    SELECT COUNT(DISTINCT session_id) as active_connections
                    FROM model_usage_stats
                    WHERE timestamp > NOW() - INTERVAL '5 minutes'
                """)
            )
            concurrent = concurrent_result.scalar() or 0

            # Get recent connection attempts (last 24 hours)
            recent_result = await self.db.execute(
                text("""
                    SELECT 
                        COUNT(*) as total_attempts,
                        COUNT(DISTINCT session_id) as unique_sessions
                    FROM model_usage_stats
                    WHERE timestamp > NOW() - INTERVAL '24 hours'
                """)
            )
            recent_row = recent_result.mappings().first()

            # Get connection trend by hour
            trend_result = await self.db.execute(
                text("""
                    SELECT
                        DATE_TRUNC('hour', timestamp) as hour,
                        COUNT(DISTINCT session_id) as connections
                    FROM model_usage_stats
                    WHERE timestamp > NOW() - INTERVAL '24 hours'
                    GROUP BY hour
                    ORDER BY hour
                """)
            )
            trend = [dict(row) for row in trend_result.mappings()]

            return {
                "concurrent_connections": concurrent,
                "recent_attempts": {
                    "total": recent_row["total_attempts"],
                    "unique_sessions": recent_row["unique_sessions"]
                },
                "hourly_trend": trend
            }

        except Exception as e:
            raise Exception(f"Failed to get connection stats: {str(e)}")

    async def get_token_usage_trend(
        self,
        model: str,
        interval: str = '1 hour',
        limit: int = 24
    ) -> List[Dict[str, Any]]:
        """
        Get token usage trend over time for a specific model.
        
        Args:
            model: The model name to get trends for
            interval: Time interval for grouping (e.g., '1 hour', '1 day')
            limit: Number of intervals to return
        
        Returns:
            List of dictionaries containing usage stats per interval
        """
        try:
            result = await self.db.execute(
                text("""
                    SELECT 
                        date_trunc(:interval, timestamp) as time_bucket,
                        SUM(prompt_tokens) as prompt_tokens,
                        SUM(completion_tokens) as completion_tokens,
                        SUM(total_tokens) as total_tokens,
                        COUNT(*) as request_count
                    FROM model_usage_stats
                    WHERE model = :model
                    GROUP BY time_bucket
                    ORDER BY time_bucket DESC
                    LIMIT :limit
                """),
                {
                    "model": model,
                    "interval": interval,
                    "limit": limit
                }
            )

            trend = []
            for row in result.mappings():
                trend.append({
                    "timestamp": row["time_bucket"],
                    "prompt_tokens": row["prompt_tokens"],
                    "completion_tokens": row["completion_tokens"],
                    "total_tokens": row["total_tokens"],
                    "request_count": row["request_count"]
                })

            return trend

        except Exception as e:
            raise Exception(f"Failed to get token usage trend: {str(e)}")
