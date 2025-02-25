#\!/usr/bin/env python

import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from database import AsyncSessionLocal

async def apply_migration(migration_file_path):
    """Apply a SQL migration file to the database"""
    try:
        print(f"Applying migration: {migration_file_path}")
        # Read the SQL file
        with open(migration_file_path, 'r') as f:
            sql_statements = f.read().split(';')
        
        # Execute each SQL statement separately
        async with AsyncSessionLocal() as session:
            for sql in sql_statements:
                sql = sql.strip()
                if sql:  # Skip empty statements
                    await session.execute(text(sql))
            await session.commit()
            
        print(f"Migration applied successfully: {migration_file_path}")
        return True
    except Exception as e:
        print(f"Error applying migration: {str(e)}")
        return False

if __name__ == "__main__":
    # Check if a specific migration file was provided
    if len(sys.argv) > 1:
        migration_file = sys.argv[1]
        # Check if the migration file exists
        if not os.path.exists(migration_file):
            migration_file = os.path.join('migrations', migration_file)
            if not os.path.exists(migration_file):
                print(f"Migration file not found: {sys.argv[1]}")
                sys.exit(1)
                
        # Apply the specified migration
        success = asyncio.run(apply_migration(migration_file))
        sys.exit(0 if success else 1)
    else:
        # Apply the latest migration
        migrations_dir = Path('migrations')
        if not migrations_dir.exists():
            print("Migrations directory not found")
            sys.exit(1)
            
        # Get all SQL files in the migrations directory
        migration_files = sorted([f for f in migrations_dir.glob('*.sql')])
        
        if not migration_files:
            print("No migration files found")
            sys.exit(1)
            
        # Apply the latest migration
        latest_migration = migration_files[-1]
        success = asyncio.run(apply_migration(latest_migration))
        sys.exit(0 if success else 1)
