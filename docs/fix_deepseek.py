import asyncio
import json
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

# Get the PostgreSQL URL from the .env file
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Get PostgreSQL connection details
POSTGRES_HOST = os.getenv("POSTGRES_HOST")
POSTGRES_USER = os.getenv("POSTGRES_USER")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")
POSTGRES_DB = os.getenv("POSTGRES_DB")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

# Construct PostgreSQL URL
POSTGRES_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"

# Get Azure endpoints and credentials
AZURE_INFERENCE_ENDPOINT = os.getenv("AZURE_INFERENCE_ENDPOINT")
AZURE_INFERENCE_CREDENTIAL = os.getenv("AZURE_INFERENCE_CREDENTIAL")
AZURE_INFERENCE_API_VERSION = os.getenv("AZURE_INFERENCE_API_VERSION", "2024-05-01-preview")

async def fix_deepseek_model():
    """Fix DeepSeek-R1 model configuration in the database"""
    print("Fixing DeepSeek-R1 model configuration...")
    print(f"Using AZURE_INFERENCE_ENDPOINT: {AZURE_INFERENCE_ENDPOINT}")
    print(f"Using AZURE_INFERENCE_API_VERSION: {AZURE_INFERENCE_API_VERSION}")

    engine = create_async_engine(POSTGRES_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # First, check if model_configs exists in the database
        result = await session.execute(
            text("SELECT value FROM app_configurations WHERE key = 'model_configs'")
        )
        row = result.fetchone()
        
        if row:
            # If model_configs exists, update it
            # The value might already be a dict or a JSON string
            value = row[0]
            if isinstance(value, str):
                model_configs = json.loads(value)
            else:
                model_configs = value
            
            # Update or add DeepSeek-R1 configuration
            model_configs["DeepSeek-R1"] = {
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
            }
            
            # Convert to JSON for storage
            model_configs_json = json.dumps(model_configs)
            
            # Update the model_configs in the database
            await session.execute(
                text(
                    """
                    UPDATE app_configurations
                    SET value = :config_value
                    WHERE key = 'model_configs'
                """
                ),
                {"config_value": model_configs_json},
            )
        else:
            # If model_configs doesn't exist, create it
            model_configs = {
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
                }
            }
            
            # Convert to JSON for storage
            model_configs_json = json.dumps(model_configs)
            
            # Insert the model_configs into the database
            await session.execute(
                text(
                    """
                    INSERT INTO app_configurations (key, value, description, is_secret)
                    VALUES ('model_configs', :config_value, 'Model configurations', true)
                """
                ),
                {"config_value": model_configs_json},
            )

        await session.commit()
        print("DeepSeek-R1 model configuration fixed successfully!")


if __name__ == "__main__":
    asyncio.run(fix_deepseek_model())
