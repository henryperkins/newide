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
import sentry_sdk
# Import the proper tracing utilities
from services.tracing_utils import trace_function, profile_block

logger = logging.getLogger(__name__)


class ModelTrackingService:
    """
    Service for tracking model transitions and ensuring reliable model switching
    """

    def __init__(self, db_session: AsyncSession):
        self.db = db_session
        self.active_transitions = {}
        self.transition_lock = asyncio.Lock()

    # Replace the incorrect trace decorator
    @trace_function(op="model.transition", name="track_model_switch", 
                   operation="model_switch", phase="start")
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

    # Replace the incorrect trace decorator
    @trace_function(op="model.transition", name="complete_model_switch", 
                   operation="model_switch", phase="complete")
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
            # Replace start_profiling_span with profile_block
            with profile_block(description="DB Insert Model Transition", 
                               op="db.insert", table="model_transitions"):
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
                # Replace start_profiling_span with profile_block
                with profile_block(description="Update Session Model", 
                                  op="db.update", table="sessions"):
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

    # For the get_model_usage_by_session method, use trace_function too
    @trace_function(op="model.stats", name="get_model_usage_by_session", 
                   operation="model_usage", type="session_usage")
    async def get_model_usage_by_session(self, session_id: uuid.UUID) -> Dict[str, Any]:
        """
        Get model usage timeline for a specific session with optimized queries
        """
        try:
            # Use a single query with LEFT JOINs for better performance
            with profile_block(description="Combined Session Usage Query", 
                              op="db.query", query_type="select"):
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

                result = await self.db.execute(
                    combined_query, {"session_id": session_id}
                )

            # Process the results
            with profile_block(description="Process Usage Results", 
                              op="data.processing"):
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