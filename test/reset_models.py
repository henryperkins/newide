import asyncio
import json
import ssl
import sys
import os
import sys

# Add the parent directory to the Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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
            "description": "Advanced reasoning model for complex tasks",
            "max_tokens": 200000,  # Based on o1 documentation (input context window)
            "max_completion_tokens": 5000,  # o-series uses max_completion_tokens
            "supports_streaming": False,  # o1 doesn't support streaming (only o3-mini does)
            "supports_temperature": False,  # o1 doesn't support temperature
            "supports_vision": True,  # o1 supports vision
            "requires_reasoning_effort": True,  # o1 supports reasoning effort
            "reasoning_effort": "medium",  # Default reasoning effort
            "api_version": config.AZURE_OPENAI_API_VERSION,
            "azure_endpoint": config.AZURE_OPENAI_ENDPOINT,
            "base_timeout": 120.0,
            "max_timeout": 300.0,
            "token_factor": 0.05
        },
        "DeepSeek-R1": {
            "name": "DeepSeek-R1",
            "description": "Model that supports chain-of-thought reasoning with <think> tags",
            "max_tokens": 32000,
            "supports_streaming": True,  # DeepSeek supports streaming
            "supports_temperature": True,  # DeepSeek uses temperature parameter
            "supports_json_response": False,  # DeepSeek doesn't support JSON response format
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
