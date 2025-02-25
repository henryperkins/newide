import asyncio
import ssl
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
import config

async def apply_migration():
    """Apply the migration to add user_id column to conversations table."""
    
    print("Starting migration: Adding user_id column to conversations table...")
    
    # Create proper SSL context with certificate verification
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = True
    ssl_context.verify_mode = ssl.CERT_REQUIRED
    ssl_context.load_verify_locations("DigiCertGlobalRootCA.crt.pem")
    
    # Construct PostgreSQL connection URL
    POSTGRES_URL = (
        f"postgresql+asyncpg://{config.settings.POSTGRES_USER}:{config.settings.POSTGRES_PASSWORD}"
        f"@{config.settings.POSTGRES_HOST}:{config.settings.POSTGRES_PORT}/{config.settings.POSTGRES_DB}?ssl=true"
    )
    
    engine = create_async_engine(
        POSTGRES_URL,
        connect_args={"ssl": ssl_context}
    )
    
    async with engine.begin() as conn:
        # Read the migration file
        with open("migrations/2025-02-26_add_user_id_to_conversations.sql", "r") as f:
            migration_sql = f.read()
        
        # Execute the migration SQL
        print("Executing migration SQL...")
        for statement in migration_sql.split(';'):
            if statement.strip():
                await conn.execute(text(statement))
        
        print("Migration completed successfully!")

if __name__ == "__main__":
    asyncio.run(apply_migration())
