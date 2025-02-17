from dotenv import load_dotenv
import os

load_dotenv()

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_DEPLOYMENT_NAME = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
AZURE_OPENAI_API_VERSION = os.getenv(
    "AZURE_OPENAI_API_VERSION",
    "2025-01-01-preview"
)

# PostgreSQL Configuration
POSTGRES_HOST = os.getenv("PGHOST")
POSTGRES_USER = os.getenv("PGUSER")
POSTGRES_PASSWORD = os.getenv("PGPASSWORD")
POSTGRES_DB = os.getenv("PGDATABASE")
POSTGRES_PORT = os.getenv("PGPORT", "5432")

POSTGRES_URL = f"postgresql+asyncpg://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}?ssl=require"

if not all([POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB]):
    raise ValueError("Missing required PostgreSQL environment variables")

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
