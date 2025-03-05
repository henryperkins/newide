import asyncio
import os
import sys
import json
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from config import (
    POSTGRES_URL,
    AZURE_OPENAI_API_VERSION,
    AZURE_OPENAI_ENDPOINT,
    AZURE_INFERENCE_API_VERSION,
    AZURE_INFERENCE_ENDPOINT,
)


async def reset_models_config():
    """Reset model configurations in the database"""
    print("Resetting model configurations...")

    engine = create_async_engine(POSTGRES_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Create default model configs
        model_configs = {
            "o1hp": {
                "name": "o1hp",
                "description": "Azure OpenAI o1 high performance model",
                "max_tokens": 40000,
                "supports_streaming": False,
                "supports_temperature": False,
                "api_version": AZURE_OPENAI_API_VERSION,
                "azure_endpoint": AZURE_OPENAI_ENDPOINT,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
            },
            "DeepSeek-R1": {
                "name": "DeepSeek-R1",
                "description": "Model that supports chain-of-thought reasoning with <think> tags",
                "azure_endpoint": AZURE_INFERENCE_ENDPOINT,
                "api_version": AZURE_INFERENCE_API_VERSION,
                "max_tokens": 32000,
                "supports_streaming": True,
                "supports_temperature": True,
                "base_timeout": 120.0,
                "max_timeout": 300.0,
                "token_factor": 0.05,
            },
        }

        # Convert to JSON for storage
        model_configs_json = json.dumps(model_configs)

        # Use raw SQL to insert or update model configs
        await session.execute(
            text(
                """
                INSERT INTO app_configurations (key, value, description, is_secret)
                VALUES ('model_configs', :config_value, 'Model configurations', true)
                ON CONFLICT (key) DO UPDATE
                SET value = :config_value
            """
            ),
            {"config_value": model_configs_json},
        )

        await session.commit()
        print("Model configurations reset successfully!")


if __name__ == "__main__":
    asyncio.run(reset_models_config())
