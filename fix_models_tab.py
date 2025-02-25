import asyncio
import json
import config
from services.config_service import ConfigService
from database import get_db_session
from sqlalchemy import select, update
from models import AppConfiguration
import sys

async def update_frontend_js():
    """
    Fix the models.js file to correctly handle API responses
    """
    db_gen = get_db_session()
    db = await anext(db_gen)
    
    try:
        # Check what's currently in the database
        result = await db.execute(
            select(AppConfiguration).where(AppConfiguration.key == "model_configs")
        )
        config_row = result.scalar_one_or_none()
        
        if config_row:
            print(f"Current model configs in DB: {config_row.value}")
        else:
            print("No model_configs found in database\!")
            
        # Create the proper model configuration
        model_configs = {
            "o1hp": {
                "name": "o1hp",
                "description": "Azure OpenAI o1 high performance model",
                "max_tokens": 40000,
                "supports_streaming": False,
                "supports_temperature": False,
                "api_version": config.AZURE_OPENAI_API_VERSION,
                "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05
            }
        }
        
        # Update the database
        if config_row:
            await db.execute(
                update(AppConfiguration)
                .where(AppConfiguration.key == "model_configs")
                .values(value=model_configs)
            )
        else:
            # Insert if not exists
            config_row = AppConfiguration(
                key="model_configs",
                value=model_configs,
                description="Azure OpenAI model configurations",
                is_secret=True
            )
            db.add(config_row)
        
        await db.commit()
        print("Updated model_configs in database successfully")
        
        # Print what we have now
        result = await db.execute(
            select(AppConfiguration).where(AppConfiguration.key == "model_configs")
        )
        config_row = result.scalar_one_or_none()
        print(f"Updated model configs: {config_row.value if config_row else 'Not found'}")
        
    except Exception as e:
        print(f"Error: {e}")
        await db.rollback()
        
if __name__ == "__main__":
    asyncio.run(update_frontend_js())
