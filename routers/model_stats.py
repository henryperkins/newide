from fastapi import APIRouter, Depends, Query, Body, HTTPException
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from database import get_db_session
from services.model_stats_service import ModelStatsService
import config

router = APIRouter(prefix="/api/model-stats")

@router.post("/usage")
async def record_model_usage(
    model: str = Body(...),
    session_id: str = Body(..., description="Session ID in UUID format"),
    usage: Dict[str, Any] = Body(...),
    metadata: Optional[Dict[str, Any]] = Body(None),
    db: AsyncSession = Depends(get_db_session)
):
    """Record model usage statistics"""
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid session ID format"
        )

    stats_service = ModelStatsService(db)
    try:
        await stats_service.record_usage(
            model=model,
            session_id=session_uuid,
            usage=usage,
            metadata=metadata
        )
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to record usage: {str(e)}"
        )

@router.get("/session/{session_id}")
async def get_session_stats(
    session_id: str,
    model: Optional[str] = None,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get usage statistics for a specific session.
    Optionally filter by model.
    """
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid session ID format"
        )
    stats_service = ModelStatsService(db)
    stats = await stats_service.get_session_stats(session_uuid, model)
    return {
        "session_id": session_id,
        "stats": stats
    }

@router.get("/model/{model_name}")
async def get_model_stats(
    model_name: str,
    period: str = Query("24h", description="Time period (e.g., '1h', '24h', '7d', '30d')"),
    interval: Optional[str] = Query(None, description="Aggregation interval (e.g., '1h', '5m')"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get usage statistics for a specific model over a time period.
    """
    # Parse time period
    now = datetime.utcnow()
    if period.endswith('h'):
        hours = int(period[:-1])
        start_time = now - timedelta(hours=hours)
    elif period.endswith('d'):
        days = int(period[:-1])
        start_time = now - timedelta(days=days)
    else:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=422,
            detail="Invalid period format. Use 'h' for hours or 'd' for days (e.g., '24h', '7d')"
        )

    stats_service = ModelStatsService(db)
    stats = await stats_service.get_model_stats(
        model=model_name,
        start_time=start_time,
        end_time=now
    )

    return {
        "model": model_name,
        "period": period,
        "stats": stats
    }

INTERVAL_MAP = {
    "1h": "hour",
    "24h": "day",
    "7d": "week",
    "30d": "month"
}

@router.get("/model/{model_name}/trend")
async def get_model_usage_trend(
    model_name: str,
    interval: str = Query("1h", regex=r"^(1h|24h|7d|30d)$"),
    points: int = Query(24, ge=1, le=1000),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get token usage trend over time for a specific model.
    """
    stats_service = ModelStatsService(db)
    trend = await stats_service.get_token_usage_trend(
        model=model_name,
        interval=interval,
        limit=points
    )

    return {
        "model": model_name,
        "interval": interval,
        "trend": trend
    }

@router.get("/comparison")
async def compare_models(
    period: str = Query("24h", description="Time period (e.g., '1h', '24h', '7d', '30d')"),
    interval: Optional[str] = Query(None, description="Aggregation interval (e.g., '1h', '5m')"),
    db: AsyncSession = Depends(get_db_session)
):
    """
    Compare usage statistics between different models over a time period.
    """
    # Parse time period
    now = datetime.utcnow()
    if period.endswith('h'):
        hours = int(period[:-1])
        start_time = now - timedelta(hours=hours)
    elif period.endswith('d'):
        days = int(period[:-1])
        start_time = now - timedelta(days=days)
    else:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=422,
            detail="Invalid period format. Use 'h' for hours or 'd' for days (e.g., '24h', '7d')"
        )

    stats_service = ModelStatsService(db)
    
    # Get stats for each model
    comparison = {}
    model_configs = getattr(config, 'MODELS', getattr(config, 'MODEL_CONFIG', {}))
    for model_name in model_configs.keys():
        if interval:
            stats = await stats_service.get_aggregated_model_stats(
                model=model_name,
                start_time=start_time,
                end_time=now,
                interval=interval
            )
        else:
            stats = await stats_service.get_model_stats(
                model=model_name,
                start_time=start_time,
                end_time=now
            )
        comparison[model_name] = stats

    return {
        "period": period,
        "comparison": comparison
    }

# Cache for connection stats to reduce DB queries
_connection_stats_cache = {"data": None, "timestamp": None}

@router.get("/connections")
async def get_connection_stats(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get active connection statistics including concurrent connections,
    recent connection attempts, and connection trends.
    """
    global _connection_stats_cache

    # Return cached data if it's less than 15 seconds old
    now = datetime.utcnow()
    if (
        _connection_stats_cache["timestamp"]
        and _connection_stats_cache["data"]
        and (now - _connection_stats_cache["timestamp"]).total_seconds() < 15
    ):
        return {"connections": _connection_stats_cache["data"]}

    # Otherwise, get fresh data
    stats_service = ModelStatsService(db)
    connections = await stats_service.get_connection_stats()

    # Update cache
    _connection_stats_cache = {
        "data": connections,
        "timestamp": now,
    }

    return {"connections": connections}


@router.get("/summary")
async def get_usage_summary(
    db: AsyncSession = Depends(get_db_session)
):
    """
    Get a summary of usage statistics across all models.
    Includes total tokens used, unique sessions, etc.
    """
    stats_service = ModelStatsService(db)
    
    # Get stats for last 24 hours and all time
    now = datetime.utcnow()
    day_ago = now - timedelta(days=1)
    
    summary = {
        "last_24h": {},
        "all_time": {},
        "models": {}
    }

    # Get stats for each model
    model_configs = getattr(config, 'MODELS', getattr(config, 'MODEL_CONFIG', {}))
    for model_name in model_configs.keys():
        # Last 24 hours
        day_stats = await stats_service.get_model_stats(
            model=model_name,
            start_time=day_ago,
            end_time=now
        )
        
        # All time
        total_stats = await stats_service.get_model_stats(
            model=model_name
        )

        summary["models"][model_name] = {
            "last_24h": day_stats,
            "all_time": total_stats
        }

        # Aggregate totals
        for key in ["prompt_tokens", "completion_tokens", "total_tokens", "unique_sessions"]:
            summary["last_24h"][key] = summary["last_24h"].get(key, 0) + day_stats.get(key, 0)
            summary["all_time"][key] = summary["all_time"].get(key, 0) + total_stats.get(key, 0)

    return summary
