import asyncio
import json
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import config


async def reset_models_config():
    """Reset model configurations in the database"""
    print("Resetting model configurations...")

    engine = create_async_engine(config.POSTGRES_URL)

    # Create default model configs
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
            "token_factor": 0.05,
        },
        "DeepSeek-R1": {
            "name": "DeepSeek-R1",
            "description": "Reasoning-focused model with high performance",
            "max_tokens": 32000,
            "supports_streaming": True,
            "supports_temperature": True,
            "api_version": config.AZURE_INFERENCE_API_VERSION,
            "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
            "base_timeout": 120.0,
            "max_timeout": 300.0,
            "token_factor": 0.05,
        },
    }

    try:
        async with engine.begin() as conn:
            # Delete existing entry first
            await conn.execute(
                text(
                    """
                DELETE FROM app_configurations 
                WHERE key = 'model_configs'
            """
                )
            )

            # Insert the new configuration
            await conn.execute(
                text(
                    """
                INSERT INTO app_configurations (key, value, description, is_secret)
                VALUES (
                    'model_configs',
                    :config_value,
                    'Reset model configurations',
                    true
                )
            """
                ),
                {"config_value": json.dumps(model_configs)},
            )

            # Verify the configuration was inserted correctly
            result = await conn.execute(
                text(
                    """
                SELECT value FROM app_configurations
                WHERE key = 'model_configs'
                """
                )
            )
            stored_config = result.scalar_one_or_none()

            if stored_config:
                print(f"Verified model configurations in database:")
                # Handle the case where stored_config might already be a dict
                if isinstance(stored_config, dict):
                    parsed_config = stored_config
                else:
                    # Otherwise parse it as JSON string
                    parsed_config = json.loads(stored_config)
                print(
                    f"- Found {len(parsed_config)} models: {', '.join(parsed_config.keys())}"
                )
            else:
                print("WARNING: Could not verify model configurations in database!")

        print("Model configurations reset successfully.")
    except Exception as e:
        print(f"Error resetting configurations: {str(e)}")
        print("Please check your database connection and try again.")


if __name__ == "__main__":
    asyncio.run(reset_models_config())
