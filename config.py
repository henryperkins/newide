from dotenv import load_dotenv
import os

load_dotenv()

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_DEPLOYMENT_NAME = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
AZURE_OPENAI_API_VERSION = os.getenv(
    "AZURE_OPENAI_API_VERSION", 
    "2024-12-01-preview"
)

# PostgreSQL Configuration
POSTGRES_URL = os.getenv("POSTGRES_URL")
if not POSTGRES_URL:
    raise ValueError("POSTGRES_URL environment variable is required")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")  # 32-url-safe-base64 bytes
SESSION_TIMEOUT_MINUTES = int(
    os.getenv("SESSION_TIMEOUT_MINUTES", "30")
)

# Validate required environment variables
required_vars = [
    AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_API_KEY,
    AZURE_OPENAI_DEPLOYMENT_NAME
]
if not all(required_vars):
    raise ValueError("Missing required Azure OpenAI environment variables")
