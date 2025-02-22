from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from database import get_db_session
from services.model_stats_service import ModelStatsService

router = APIRouter(prefix="/api/model-stats")

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
    stats_service = ModelStatsService(db)
    stats = await stats_service.get_session_stats(session_id, model)
    return {
        "session_id": session_id,
        "stats": stats
    }

@router.get("/model/{model_name}")
async def get_model_stats(
    model_name: str,
    period: str = Query("24h", description="Time period (e.g., '1h', '24h', '7d', '30d')"),
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
        raise ValueError("Invalid period format. Use 'h' for hours or 'd' for days (e.g., '24h', '7d')")

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

@router.get("/model/{model_name}/trend")
async def get_model_usage_trend(
    model_name: str,
    interval: str = Query("1h", description="Time interval for grouping (e.g., '1h', '1d')"),
    points: int = Query(24, description="Number of data points to return"),
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
        raise ValueError("Invalid period format. Use 'h' for hours or 'd' for days (e.g., '24h', '7d')")

    stats_service = ModelStatsService(db)
    
    # Get stats for each model
    comparison = {}
    for model_name in config.MODEL_CONFIGS.keys():
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
    for model_name in config.MODEL_CONFIGS.keys():
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
