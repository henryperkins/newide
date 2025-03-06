"""
Service for tracking model transitions and ensuring reliable model switching
"""

from typing import Dict, Any, Optional, List, Tuple, Union
import uuid
import time
from datetime import datetime, timedelta
import asyncio

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import logging

logger = logging.getLogger(__name__)


class ModelTrackingService:
    """
    Service for tracking model transitions and ensuring reliable model switching
    """

    def __init__(self, db_session: AsyncSession):
        self.db = db_session
        self.active_transitions = {}
        self.transition_lock = asyncio.Lock()

    async def track_model_switch(
        self,
        session_id: uuid.UUID,
        from_model: str,
        to_model: str,
        tracking_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Start tracking a model switch operation
        """
        if not tracking_id:
            tracking_id = str(uuid.uuid4())

        start_time = time.time()

        async with self.transition_lock:
            self.active_transitions[tracking_id] = {
                "session_id": session_id,
                "from_model": from_model,
                "to_model": to_model,
                "start_time": start_time,
                "metadata": metadata or {},
                "status": "in_progress",
            }

        # Log the start of a model transition
        logger.info(
            f"Starting model transition {tracking_id}: {from_model} -> {to_model} for session {session_id}"
        )

        return {
            "tracking_id": tracking_id,
            "session_id": session_id,
            "from_model": from_model,
            "to_model": to_model,
            "status": "in_progress",
        }

    async def complete_model_switch(
        self,
        tracking_id: str,
        success: bool = True,
        error_message: Optional[str] = None,
        additional_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Complete a model switch operation and record it in the database
        """
        async with self.transition_lock:
            if tracking_id not in self.active_transitions:
                logger.warning(
                    f"No active transition found for tracking_id {tracking_id}"
                )
                return {
                    "tracking_id": tracking_id,
                    "status": "not_found",
                    "success": False,
                    "error": "No active transition found",
                }

            transition = self.active_transitions.pop(tracking_id)

        end_time = time.time()
        duration_ms = int((end_time - transition["start_time"]) * 1000)

        # Merge additional metadata if provided
        metadata = {
            **(transition.get("metadata") or {}),
            **(additional_metadata or {}),
            "duration_ms": duration_ms,
        }

        # Record the transition in the database
        try:
            await self.db.execute(
                text(
                    """
                    INSERT INTO model_transitions (
                        session_id,
                        from_model,
                        to_model,
                        tracking_id,
                        success,
                        error_message,
                        duration_ms,
                        metadata
                    ) VALUES (
                        :session_id,
                        :from_model,
                        :to_model,
                        :tracking_id,
                        :success,
                        :error_message,
                        :duration_ms,
                        :metadata
                    )
                """
                ),
                {
                    "session_id": transition["session_id"],
                    "from_model": transition["from_model"],
                    "to_model": transition["to_model"],
                    "tracking_id": tracking_id,
                    "success": 1 if success else 0,
                    "error_message": error_message,
                    "duration_ms": duration_ms,
                    "metadata": metadata,
                },
            )

            if success:
                # Update the session's last_model
                await self.db.execute(
                    text(
                        """
                        UPDATE sessions
                        SET last_model = :model
                        WHERE id = :session_id
                    """
                    ),
                    {
                        "model": transition["to_model"],
                        "session_id": transition["session_id"],
                    },
                )

            await self.db.commit()

            log_level = logging.INFO if success else logging.WARNING
            logger.log(
                log_level,
                f"Model transition {tracking_id} completed: {transition['from_model']} -> {transition['to_model']} "
                f"(success={success}, duration={duration_ms}ms)",
            )

            return {
                "tracking_id": tracking_id,
                "session_id": transition["session_id"],
                "from_model": transition["from_model"],
                "to_model": transition["to_model"],
                "duration_ms": duration_ms,
                "success": success,
                "error_message": error_message,
                "status": "completed",
            }

        except Exception as e:
            await self.db.rollback()
            logger.exception(
                f"Error recording model transition {tracking_id}: {str(e)}"
            )
            return {
                "tracking_id": tracking_id,
                "status": "error",
                "success": False,
                "error": str(e),
            }

    async def get_transition_stats(
        self,
        from_model: Optional[str] = None,
        to_model: Optional[str] = None,
        session_id: Optional[uuid.UUID] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """
        Get statistics about model transitions
        """
        params = {}
        query = """
            SELECT 
                from_model, 
                to_model, 
                AVG(duration_ms) as avg_duration,
                COUNT(*) as total_count,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count
            FROM model_transitions
            WHERE 1=1
        """

        if from_model:
            query += " AND from_model = :from_model"
            params["from_model"] = from_model

        if to_model:
            query += " AND to_model = :to_model"
            params["to_model"] = to_model

        if session_id:
            query += " AND session_id = :session_id"
            params["session_id"] = session_id

        if start_time:
            query += " AND timestamp >= :start_time"
            params["start_time"] = start_time

        if end_time:
            query += " AND timestamp <= :end_time"
            params["end_time"] = end_time

        query += " GROUP BY from_model, to_model"

        result = await self.db.execute(text(query), params)
        rows = [dict(row) for row in result.mappings()]

        return {
            "transitions": rows,
            "total_transitions": sum(row["total_count"] for row in rows),
            "success_rate": sum(row["success_count"] for row in rows)
            / max(1, sum(row["total_count"] for row in rows)),
            "avg_duration_overall": sum(
                row["avg_duration"] * row["total_count"] for row in rows
            )
            / max(1, sum(row["total_count"] for row in rows)),
        }

    async def get_model_usage_by_session(self, session_id: uuid.UUID) -> Dict[str, Any]:
        """
        Get model usage timeline for a specific session with optimized queries
        """
        try:
            # Use a single query with LEFT JOINs for better performance
            combined_query = text(
                """
                WITH base_transitions AS (
                    SELECT 
                        from_model,
                        to_model,
                        tracking_id,
                        timestamp,
                        success
                    FROM model_transitions
                    WHERE session_id = :session_id
                    ORDER BY timestamp
                ),
                base_usage AS (
                    SELECT
                        model,
                        tracking_id,
                        SUM(prompt_tokens) as prompt_tokens,
                        SUM(completion_tokens) as completion_tokens,
                        SUM(total_tokens) as total_tokens,
                        COUNT(*) as request_count,
                        MIN(timestamp) as first_use,
                        MAX(timestamp) as last_use
                    FROM model_usage_stats
                    WHERE session_id = :session_id
                    GROUP BY model, tracking_id
                ),
                base_conversations AS (
                    SELECT
                        model,
                        tracking_id,
                        COUNT(*) as message_count
                    FROM conversations
                    WHERE session_id = :session_id AND role = 'assistant'
                    GROUP BY model, tracking_id
                )
                
                SELECT
                    'transitions' as data_type,
                    json_agg(t.*) as data
                FROM base_transitions t
                UNION ALL
                SELECT
                    'usage' as data_type,
                    json_agg(u.*) as data
                FROM base_usage u
                UNION ALL
                SELECT
                    'conversations' as data_type,
                    json_agg(c.*) as data
                FROM base_conversations c
            """
            )

            result = await self.db.execute(combined_query, {"session_id": session_id})

            # Process the results
            rows = result.fetchall()
            data = {
                "session_id": session_id,
                "transitions": [],
                "usage": [],
                "conversations": [],
            }

            for row in rows:
                data_type, data_json = row
                if data_json:  # May be None if no data for a section
                    data[data_type] = data_json

            return data

        except Exception as e:
            logger.exception(
                f"Error getting model usage for session {session_id}: {str(e)}"
            )
            return {
                "session_id": session_id,
                "error": str(e),
                "transitions": [],
                "usage": [],
                "conversations": [],
            }

    async def cleanup_stale_transitions(self, older_than_minutes: int = 30) -> int:
        """
        Clean up stale transition tracking records
        """
        cutoff_time = time.time() - (older_than_minutes * 60)
        count = 0

        async with self.transition_lock:
            stale_ids = [
                tracking_id
                for tracking_id, transition in self.active_transitions.items()
                if transition["start_time"] < cutoff_time
            ]

            for tracking_id in stale_ids:
                transition = self.active_transitions.pop(tracking_id)
                count += 1

                # Log stale transition
                logger.warning(
                    f"Cleaned up stale transition {tracking_id}: "
                    f"{transition['from_model']} -> {transition['to_model']} "
                    f"for session {transition['session_id']} "
                    f"(started {int(time.time() - transition['start_time'])}s ago)"
                )

        return count
