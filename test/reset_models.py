import asyncio
import json
import ssl
import sys
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import config

async def reset_models_config():
    print("Starting reset_models_config...")
    # Create proper SSL context
    print("Creating SSL context...")
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = True
    ssl_context.verify_mode = ssl.CERT_REQUIRED
    ssl_context.load_verify_locations("DigiCertGlobalRootCA.crt.pem")
    
    print(f"Connecting to database: {config.POSTGRES_URL}")
    engine = create_async_engine(
        config.POSTGRES_URL,
        connect_args={"ssl": ssl_context}
    )
    
    # Create a complete model config for o1hp and DeepSeek-R1
    print("Creating model configurations...")
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
        },
        "DeepSeek-R1": {
            "name": "DeepSeek-R1",
            "description": "Reasoning-focused model with high performance in math, coding, and science",
            "max_tokens": 32000,
            "supports_streaming": True,
            "supports_temperature": True,
            "api_version": config.AZURE_INFERENCE_API_VERSION,
            "azure_endpoint": config.AZURE_INFERENCE_ENDPOINT,
            "base_timeout": 120.0,
            "max_timeout": 300.0,
            "token_factor": 0.05
        }
    }
    
    async with engine.begin() as conn:
        print("Deleting existing model configurations...")
        # Delete existing entry first to clean slate
        await conn.execute(text("""
            DELETE FROM app_configurations 
            WHERE key = 'model_configs'
        """))
        
        print("Inserting new model configurations...")
        # Insert the new configuration
        await conn.execute(text("""
            INSERT INTO app_configurations (key, value, description, is_secret)
            VALUES (
                'model_configs',
                :config_value,
                'Azure OpenAI model configurations',
                true
            )
        """), {"config_value": json.dumps(model_configs)})
        
        print("Model configurations reset successfully.")
        
        # Verify the insertion
        print("Verifying insertion...")
        result = await conn.execute(text("""
            SELECT value FROM app_configurations 
            WHERE key = 'model_configs'
        """))
        row = result.fetchone()
        if row:
            print(f"Retrieved model_configs: {row[0]}")
        else:
            print("Failed to retrieve model_configs!")

if __name__ == "__main__":
    try:
        asyncio.run(reset_models_config())
        print("Script completed successfully.")
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)
