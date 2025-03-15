#!/usr/bin/env python
"""
Reset the database by dropping all tables and recreating them.
This will wipe ALL user data and let you start fresh.
"""

import asyncio
import sys
import os
import logging
from sqlalchemy.schema import DropTable
from sqlalchemy.ext.asyncio import create_async_engine

# Add the root directory to the path so we can import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import required modules
import config  # noqa: E402
from models import Base  # noqa: E402

# Set up logger
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def reset_database():
    """Drop all tables and recreate them."""
    engine = None
    try:
        # Simplest direct connection (no SSL, directly to postgres)
        connection_string = (
            f"postgresql+asyncpg://{config.settings.POSTGRES_USER}:{config.settings.POSTGRES_PASSWORD}"
            f"@{config.settings.POSTGRES_HOST}:{config.settings.POSTGRES_PORT}/{config.settings.POSTGRES_DB}"
        )
        
        logger.info("Creating direct database connection...")
        engine = create_async_engine(connection_string, echo=True)
        
        # Get confirmation
        logger.info("!!! WARNING !!!")
        logger.info("This will DELETE ALL DATA in the database.")
        confirm = input("Type 'yes' to confirm: ")
        
        if confirm.lower() != 'yes':
            logger.info("Database reset cancelled.")
            return
        
        logger.info("Dropping all tables...")
        async with engine.begin() as conn:
            # Get list of all tables to drop them in reverse order (due to dependencies)
            # First create them all to get the metadata
            await conn.run_sync(Base.metadata.create_all)
            
            # Then drop them
            for table in reversed(Base.metadata.sorted_tables):
                logger.info(f"Dropping table {table.name}")
                await conn.execute(DropTable(table, if_exists=True))
                
        logger.info("Creating all tables fresh...")
        async with engine.begin() as conn:
            # Create all tables clean
            await conn.run_sync(Base.metadata.create_all)
            
        logger.info("Database reset complete. The tables are now empty.")
        logger.info("You can now register a new user account.")
        
    except Exception as e:
        logger.error(f"Error resetting database: {str(e)}")
        raise
    finally:
        # Clean up
        if engine is not None:
            await engine.dispose()

if __name__ == "__main__":
    asyncio.run(reset_database())
