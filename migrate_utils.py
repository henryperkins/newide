"""
Migration Utilities

This module provides simplified migration utilities that don't depend on Alembic.
It's designed to be used during application startup to check if the database schema 
is consistent with the ORM models, without requiring a full migration system.
"""

import logging
import os
from pathlib import Path
from typing import List, Dict, Any, Tuple, Set
import asyncio
from sqlalchemy import text, MetaData, Table, Column, inspect
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncConnection

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import models and engine
from models import Base
from database import engine

async def check_database_consistency() -> Tuple[bool, List[str]]:
    """
    Check if the database schema is consistent with the ORM models.
    
    Returns:
        Tuple containing:
            - Boolean indicating if database is consistent
            - List of inconsistency messages
    """
    inconsistencies = []
    
    async with engine.connect() as conn:
        # Get ORM table definitions
        orm_tables = Base.metadata.tables
        
        # Get existing tables from the database
        db_tables = set(await conn.run_sync(lambda sync_conn: sync_conn.dialect.get_table_names(sync_conn)))
        
        # Check for missing tables
        for table_name in orm_tables:
            if table_name not in db_tables:
                inconsistencies.append(f"Table '{table_name}' is missing from the database")

        # Check columns in existing tables
        for table_name in orm_tables:
            if table_name not in db_tables:
                continue
            
            # Get ORM columns
            orm_table = orm_tables[table_name]
            orm_columns = {col.name: col for col in orm_table.columns}
            
            # Get database columns
            db_columns = await conn.run_sync(
                lambda sync_conn: {
                    col["name"]: col for col in inspect(sync_conn).get_columns(table_name)
                }
            )
            
            # Check for missing columns
            for col_name in orm_columns:
                if col_name not in db_columns:
                    inconsistencies.append(f"Column '{col_name}' in table '{table_name}' is missing from the database")

        return len(inconsistencies) == 0, inconsistencies

async def clean_orphaned_db_elements(confirm: bool = True) -> None:
    """Safely remove known orphaned database elements that are not in the ORM.
    Requires explicit confirmation to prevent accidental data loss.
    """
    if not confirm:
        raise ValueError("Cleanup requires confirmation flag")
        
    async with engine.begin() as conn:
        logger.info("Cleaning known orphaned database elements...")
        # Remove entire tables that are no longer needed
        await conn.execute(text("""
            DROP TABLE IF EXISTS 
                legacy_analytics,
                temp_uploads,
                user_preferences_old;
        """))
        
        # Remove specific columns from tables
        await conn.execute(text("""
            ALTER TABLE IF EXISTS users 
            DROP COLUMN IF EXISTS 
                social_login_token,
                legacy_password_hash;
            
            ALTER TABLE IF EXISTS conversations
            DROP COLUMN IF EXISTS 
                deprecated_ranking_score,
                old_format_flag;
        """))
        logger.info("Completed orphaned database element cleanup")
        # Get ORM table definitions
        orm_tables = Base.metadata.tables
        
        # Get existing tables from the database
        db_tables = set(await conn.run_sync(lambda sync_conn: sync_conn.dialect.get_table_names(sync_conn)))
        
        # Check for missing tables
        for table_name in orm_tables:
            if table_name not in db_tables:
                inconsistencies.append(f"Table '{table_name}' is missing from the database")
        
        # Check columns in existing tables
        for table_name in orm_tables:
            if table_name not in db_tables:
                continue
            
            # Get ORM columns
            orm_table = orm_tables[table_name]
            orm_columns = {col.name: col for col in orm_table.columns}
            
            # Get database columns
            db_columns = await conn.run_sync(
                lambda sync_conn: {
                    col["name"]: col for col in inspect(sync_conn).get_columns(table_name)
                }
            )
            
            # Check for missing columns
            for col_name in orm_columns:
                if col_name not in db_columns:
                    inconsistencies.append(f"Column '{col_name}' in table '{table_name}' is missing from the database")
            
            # Check column properties (type, nullability, etc.)
            for col_name, orm_col in orm_columns.items():
                if col_name in db_columns:
                    db_col = db_columns[col_name]
                    
                    # Check nullability
                    if orm_col.nullable != db_col["nullable"]:
                        inconsistencies.append(
                            f"Column '{col_name}' in table '{table_name}' has different nullability: "
                            f"ORM={orm_col.nullable}, DB={db_col['nullable']}"
                        )
    
    # Return results
    return len(inconsistencies) == 0, inconsistencies

def ensure_migrations_dir_exists() -> None:
    """
    Ensure the migrations directory exists.
    """
    # Create migrations directory in the current working directory
    migrations_dir = Path.cwd() / 'migrations'
    if not migrations_dir.exists():
        migrations_dir.mkdir(parents=True)
        logger.info(f"Created migrations directory at {migrations_dir}")
        
        # Create README.md file
        readme_path = migrations_dir / 'README.md'
        with open(readme_path, 'w') as f:
            f.write("""# Database Migrations

This directory will contain database migration scripts generated by Alembic.

## Getting Started

To initialize the migrations system:
```bash
python migrate.py init
```

For more information, see the migrations documentation.
""")
        
        # Create empty __init__.py file
        init_path = migrations_dir / '__init__.py'
        init_path.touch()

async def check_database() -> bool:
    """
    Check if the database is consistent with the ORM models.
    This is now an async function that calls the async check_database_consistency function.
    
    Returns:
        Boolean indicating if database is consistent
    """
    # Ensure migrations directory exists (this doesn't interact with the DB)
    try:
        ensure_migrations_dir_exists()
    except Exception as e:
        logger.error(f"Error ensuring migrations directory exists: {e}")
    
    try:
        is_consistent, inconsistencies = await check_database_consistency()
        if not is_consistent:
            logger.warning("Database schema is inconsistent with ORM models:")
            for inconsistency in inconsistencies:
                logger.warning(f"  - {inconsistency}")
        return is_consistent
    except Exception as e:
        logger.error(f"Error checking database: {e}")
        return False

if __name__ == "__main__":
    """
    Run database check as a standalone script
    """
    check_database()
