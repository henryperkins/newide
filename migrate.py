#!/usr/bin/env python
"""
Database Migration Utility

This script provides a command-line interface for managing database migrations.
It uses Alembic to track, generate, and apply schema changes in a controlled manner.

Usage:
  python migrate.py init                  # Initialize migration environment
  python migrate.py create "description"  # Create a new migration
  python migrate.py upgrade [revision]    # Upgrade to latest or specified revision
  python migrate.py downgrade [revision]  # Downgrade to previous or specified revision
  python migrate.py current               # Show current revision
  python migrate.py history               # Show migration history
  python migrate.py check                 # Check if database is up-to-date with migrations
"""

import os
import sys
import argparse
import asyncio
import logging
from alembic.config import Config
from alembic import command, script
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, text
import ssl

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Define alembic paths
ALEMBIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'migrations')
ALEMBIC_INI = os.path.join(ALEMBIC_DIR, 'alembic.ini')

def get_alembic_config():
    """Create and configure Alembic config object"""
    config = Config(ALEMBIC_INI)
    config.set_main_option('script_location', ALEMBIC_DIR)
    
    # Import database connection string from main config
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    try:
        import config as app_config
        db_url = app_config.POSTGRES_URL
        # Replace asyncpg with psycopg2 for Alembic compatibility
        db_url = db_url.replace('postgresql+asyncpg', 'postgresql')
        config.set_main_option('sqlalchemy.url', db_url)
    except ImportError:
        logger.error("Failed to import application config. Please ensure config.py exists.")
        sys.exit(1)
    
    return config

def init_migrations():
    """Initialize the Alembic environment if it doesn't exist"""
    # Create migrations directory if needed
    os.makedirs(ALEMBIC_DIR, exist_ok=True)
    
    env_py = os.path.join(ALEMBIC_DIR, 'env.py')
    if not os.path.exists(env_py):
        logger.info("Initializing Alembic migration environment...")
        # Create basic env.py manually
        with open(env_py, 'w') as f:
            f.write("from alembic import context\n")
            f.write("from models import Base\n")
            f.write("target_metadata = Base.metadata\n")
            f.write("def run_migrations_online():\n")
            f.write("    connectable = context.config.attributes.get('connection', None)\n")
            f.write("    if connectable is None:\n")
            f.write("        from sqlalchemy import engine_from_config\n")
            f.write("        connectable = engine_from_config(context.config.get_section(context.config.config_ini_section))\n")
            f.write("    with connectable.connect() as connection:\n")
            f.write("        context.configure(connection=connection, target_metadata=target_metadata)\n")
            f.write("        with context.begin_transaction():\n")
            f.write("            context.run_migrations()\n")
        
        # Create env.py if it doesn't exist
        if not os.path.exists(env_py):
            with open(env_py, 'w') as f:
                f.write("from alembic import context\n")
                f.write("from models import Base\n")
                f.write("target_metadata = Base.metadata\n")
        
        # Update the generated alembic.ini with our settings
        with open(ALEMBIC_INI, 'a') as f:
            f.write("\n# Added by migration script\n")
            f.write("# Set to 'true' to run the environment during\n")
            f.write("# the 'revision' command, regardless of autogenerate\n")
            f.write("revision_environment = true\n")
        
        # Update env.py to import our models
        env_py = os.path.join(ALEMBIC_DIR, 'env.py')
        with open(env_py, 'r') as f:
            content = f.read()
        
        # Add our model imports
        modified_content = content.replace(
            "target_metadata = None",
            "from models import Base\ntarget_metadata = Base.metadata"
        )
        
        with open(env_py, 'w') as f:
            f.write(modified_content)
        
        logger.info(f"Migration environment initialized at {ALEMBIC_DIR}")
    else:
        logger.info("Migration environment already exists.")

def create_migration(message):
    """Create a new migration with the given message"""
    config = get_alembic_config()
    logger.info(f"Creating migration: {message}")
    command.revision(config, message=message, autogenerate=True)
    logger.info("Migration created successfully.")

def upgrade_database(revision='head'):
    """Upgrade database to the specified revision or latest if not specified"""
    config = get_alembic_config()
    logger.info(f"Upgrading database to revision: {revision}")
    command.upgrade(config, revision)
    logger.info("Database upgraded successfully.")

def downgrade_database(revision='-1'):
    """Downgrade database to the specified revision or previous if not specified"""
    config = get_alembic_config()
    logger.info(f"Downgrading database to revision: {revision}")
    command.downgrade(config, revision)
    logger.info("Database downgraded successfully.")

def show_current_revision():
    """Show the current database revision"""
    config = get_alembic_config()
    script_directory = script.ScriptDirectory.from_config(config)
    
    # Get database connection
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    import config as app_config
    
    # Create SSL context
    ssl_context = ssl.create_default_context()
    ssl_context.verify_mode = ssl.CERT_REQUIRED
    ssl_context.check_hostname = True
    
    try:
        ssl_context.load_verify_locations("DigiCertGlobalRootCA.crt.pem")
    except Exception as e:
        logger.error(f"Failed to load SSL certificate: {e}")
        sys.exit(1)
    
    # Get database URL and replace asyncpg with psycopg2
    db_url = app_config.POSTGRES_URL.replace('postgresql+asyncpg', 'postgresql')
    
    engine = create_engine(db_url, connect_args={"sslmode": "verify-full", "sslrootcert": "DigiCertGlobalRootCA.crt.pem"})
    
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        current_rev = context.get_current_revision()
    
    if current_rev:
        # Get the migration information
        for sc in script_directory.walk_revisions():
            if sc.revision == current_rev:
                logger.info(f"Current revision: {current_rev} - {sc.doc}")
                return
        
        logger.info(f"Current revision: {current_rev}")
    else:
        logger.info("Database is at base revision (no migrations applied).")

def show_migration_history():
    """Show the migration history"""
    config = get_alembic_config()
    command.history(config, verbose=True)

def check_database():
    """Check if database is up-to-date with migrations"""
    config = get_alembic_config()
    script_directory = script.ScriptDirectory.from_config(config)
    
    # Get latest revision
    head_revision = script_directory.get_current_head()
    
    # Get current revision
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    import config as app_config
    
    # Create SSL context
    ssl_context = ssl.create_default_context()
    ssl_context.verify_mode = ssl.CERT_REQUIRED
    ssl_context.check_hostname = True
    
    try:
        ssl_context.load_verify_locations("DigiCertGlobalRootCA.crt.pem")
    except Exception as e:
        logger.error(f"Failed to load SSL certificate: {e}")
        sys.exit(1)
    
    # Get database URL and replace asyncpg with psycopg2
    db_url = app_config.POSTGRES_URL.replace('postgresql+asyncpg', 'postgresql')
    
    engine = create_engine(db_url, connect_args={"sslmode": "verify-full", "sslrootcert": "DigiCertGlobalRootCA.crt.pem"})
    
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        current_rev = context.get_current_revision()
    
    if current_rev != head_revision:
        logger.warning(f"Database is not up-to-date.")
        logger.warning(f"Current revision: {current_rev}")
        logger.warning(f"Latest revision: {head_revision}")
        logger.warning("Run 'python migrate.py upgrade' to update the database.")
        return False
    else:
        logger.info("Database is up-to-date with migrations.")
        return True

def main():
    """Main entry point for the migration utility"""
    parser = argparse.ArgumentParser(description="Database Migration Utility")
    subparsers = parser.add_subparsers(dest="command", help="Migration command")
    
    # Init command
    subparsers.add_parser("init", help="Initialize migration environment")
    
    # Create command
    create_parser = subparsers.add_parser("create", help="Create a new migration")
    create_parser.add_argument("message", help="Migration message")
    
    # Upgrade command
    upgrade_parser = subparsers.add_parser("upgrade", help="Upgrade to latest or specified revision")
    upgrade_parser.add_argument("revision", nargs="?", default="head", help="Revision to upgrade to (default: head)")
    
    # Downgrade command
    downgrade_parser = subparsers.add_parser("downgrade", help="Downgrade to previous or specified revision")
    downgrade_parser.add_argument("revision", nargs="?", default="-1", help="Revision to downgrade to (default: -1)")
    
    # Current command
    subparsers.add_parser("current", help="Show current revision")
    
    # History command
    subparsers.add_parser("history", help="Show migration history")
    
    # Check command
    subparsers.add_parser("check", help="Check if database is up-to-date with migrations")
    
    args = parser.parse_args()
    
    # Execute the appropriate command
    if args.command == "init":
        init_migrations()
    elif args.command == "create":
        create_migration(args.message)
    elif args.command == "upgrade":
        upgrade_database(args.revision)
    elif args.command == "downgrade":
        downgrade_database(args.revision)
    elif args.command == "current":
        show_current_revision()
    elif args.command == "history":
        show_migration_history()
    elif args.command == "check":
        check_database()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
