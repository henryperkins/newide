"""
Database Schema Validation Integration for FastAPI

This module integrates the schema validation utility with FastAPI's startup events.
It ensures that the database schema matches the ORM models before the application starts.
"""

import logging
import asyncio
import os
import functools
from fastapi import FastAPI
from contextlib import asynccontextmanager
from schema_validation import validate_database_schema
from migrate_utils import check_database, ensure_migrations_dir_exists


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def db_validation_lifespan(lifespan_func):
    """
    Decorator that wraps a lifespan function with database schema validation.
    
    Example usage:
        @db_validation_lifespan
        @asynccontextmanager
        async def lifespan(app: FastAPI):
            # Your startup logic here
            yield
    """
    @functools.wraps(lifespan_func)
    @asynccontextmanager
    async def wrapped_lifespan(app: FastAPI):
        # Get validation settings from environment or config
        fail_on_error = os.getenv("DB_VALIDATION_FAIL_ON_ERROR", "false").lower() == "true"
        check_migrations_flag = os.getenv("DB_CHECK_MIGRATIONS", "true").lower() == "true"
        
        validation_errors = []
        schema_valid = False
        
        try:
            # Create migrations directory if it doesn't exist
            try:
                ensure_migrations_dir_exists()
            except Exception as e:
                logger.error(f"Error ensuring migrations directory exists: {str(e)}")
            
            # Check migrations if enabled
            if check_migrations_flag:
                logger.info("Checking database migrations...")
                try:
                    migrations_up_to_date = await check_database()
                    if not migrations_up_to_date:
                        message = "Database schema is inconsistent with ORM models."
                        validation_errors.append(message)
                        logger.error(message)
                except Exception as e:
                    message = f"Error checking migrations: {str(e)}"
                    validation_errors.append(message)
                    logger.error(message)

                    from migrate import get_alembic_config
                    from alembic import command

                    logger.info("Migrations are out of date. Running 'upgrade head' automatically...")
                    alembic_cfg = get_alembic_config()
                    command.upgrade(alembic_cfg, "head")
            
            # Validate database schema
            logger.info("Validating database schema against ORM models...")
            try:
                schema_valid = await validate_database_schema(fail_on_error=False)
                if not schema_valid:
                    message = "Database schema validation failed. Database schema does not match ORM models."
                    validation_errors.append(message)
                    logger.error(message)
            except Exception as e:
                message = f"Error during database validation: {str(e)}"
                validation_errors.append(message)
                logger.error(message)
                schema_valid = False
            
            # If there are validation errors and we should fail, raise exception
            if validation_errors and fail_on_error:
                error_message = "Database validation failed:\n" + "\n".join(validation_errors)
                logger.error(error_message)
                raise RuntimeError(error_message)
            
            # Validation passed or errors were ignored
            if schema_valid and not validation_errors:
                logger.info("Database validation passed successfully.")
            else:
                logger.warning("Database validation had issues, but continuing anyway.")
            
            # Properly yield control to the wrapped async context manager
            async with lifespan_func(app):
                yield
                
        except Exception as e:
            logger.error(f"Error during database validation: {str(e)}")
            if fail_on_error:
                raise
            
            logger.warning("Continuing despite validation errors...")
            await asyncio.sleep(0.5)
            
            async with lifespan_func(app):
                yield
    
    return wrapped_lifespan


def setup_startup_validation(app: FastAPI) -> None:
    """
    Alternative approach: Set up database validation as a startup event handler.
    This can be used if you don't want to use the lifespan feature.
    
    Example usage:
        app = FastAPI()
        setup_startup_validation(app)
    """
    @app.on_event("startup")
    async def validate_database():
        # Get validation settings
        fail_on_error = os.getenv("DB_VALIDATION_FAIL_ON_ERROR", "false").lower() == "true"
        check_migrations_flag = os.getenv("DB_CHECK_MIGRATIONS", "true").lower() == "true"
        
        # Create migrations directory if it doesn't exist
        try:
            ensure_migrations_dir_exists()
        except Exception as e:
            logger.error(f"Error ensuring migrations directory exists: {str(e)}")
        
        # Check migrations if enabled
        if check_migrations_flag:
            logger.info("Checking database migrations...")
            try:
                # Use the simplified migration checker
                migrations_up_to_date = check_database()
                if not migrations_up_to_date:
                    message = "Database schema is inconsistent with ORM models."
                    logger.error(message)
                    if fail_on_error:
                        raise RuntimeError(message)
            except Exception as e:
                message = f"Error checking migrations: {str(e)}"
                logger.error(message)
                if fail_on_error:
                    raise RuntimeError(message)
        
        # Validate database schema
        logger.info("Validating database schema against ORM models...")
        try:
            schema_valid = await validate_database_schema(fail_on_error=False)
            if schema_valid:
                logger.info("Database validation passed successfully.")
            elif fail_on_error:
                raise RuntimeError("Database schema validation failed.")
        except Exception as e:
            logger.error(f"Database validation failed: {str(e)}")
            if fail_on_error:
                raise RuntimeError(f"Database validation failed: {str(e)}")
