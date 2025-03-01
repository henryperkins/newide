"""
Database Schema Validation Integration for FastAPI

This module integrates the schema validation utility with FastAPI's startup events.
It ensures that the database schema matches the ORM models before the application starts.
"""

import logging
import asyncio
import os
import functools
from typing import Dict, List, Any, Optional, Callable, AsyncGenerator
from fastapi import FastAPI, HTTPException
from sqlalchemy.ext.asyncio import AsyncEngine
from contextlib import asynccontextmanager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import the schema validation function
from schema_validation import validate_database_schema
from migrate import check_database as check_migrations

# Import your FastAPI app's configuration
import config

def db_validation_lifespan(lifespan_func):
    """
    Decorator that wraps a lifespan function with database schema validation.
    
    Example usage:
        @db_validation_lifespan
        async def lifespan(app: FastAPI):
            # Your startup logic here
            yield
    """
    @functools.wraps(lifespan_func)
    async def wrapped_lifespan(app: FastAPI):
        # Get validation settings from environment or config
        fail_on_error = os.getenv("DB_VALIDATION_FAIL_ON_ERROR", "false").lower() == "true"
        check_migrations_flag = os.getenv("DB_CHECK_MIGRATIONS", "true").lower() == "true"
        
        # Schema validation errors
        validation_errors = []
        
        try:
            # Check migrations if enabled
            if check_migrations_flag:
                logger.info("Checking database migrations...")
                try:
                    # Call the migrate.py check function
                    migrations_up_to_date = await asyncio.to_thread(check_migrations)
                    if not migrations_up_to_date:
                        message = "Database migrations are not up-to-date. Run 'python migrate.py upgrade' to update."
                        validation_errors.append(message)
                        logger.error(message)
                except Exception as e:
                    message = f"Error checking migrations: {str(e)}"
                    validation_errors.append(message)
                    logger.error(message)
            
            # Validate database schema
            logger.info("Validating database schema against ORM models...")
            schema_valid = await validate_database_schema(fail_on_error=False)  # Never fail here, collect errors instead
            
            if not schema_valid:
                message = "Database schema validation failed. Database schema does not match ORM models."
                validation_errors.append(message)
                logger.error(message)
            
            # If there are validation errors and we should fail, raise exception
            if validation_errors and fail_on_error:
                error_message = "Database validation failed:\n" + "\n".join(validation_errors)
                logger.error(error_message)
                raise HTTPException(status_code=500, detail=error_message)
            
            # Validation passed or errors were ignored
            if not validation_errors:
                logger.info("Database validation passed successfully.")
            
            # Call the original lifespan function
            async for value in lifespan_func(app):
                yield value
                
        except Exception as e:
            logger.error(f"Error during database validation: {str(e)}")
            if fail_on_error:
                raise
            
            # If not failing on error, still run the original lifespan
            async for value in lifespan_func(app):
                yield value
    
    return wrapped_lifespan

# Original context manager version (kept for backwards compatibility)
@asynccontextmanager
async def db_validation_context(app: FastAPI):
    """
    FastAPI lifespan context manager that validates database schema on startup.
    
    Example usage:
        app = FastAPI(lifespan=db_validation_context)
    """
    # Get validation settings from environment or config
    fail_on_error = os.getenv("DB_VALIDATION_FAIL_ON_ERROR", "false").lower() == "true"
    check_migrations_flag = os.getenv("DB_CHECK_MIGRATIONS", "true").lower() == "true"
    
    # Schema validation errors
    validation_errors = []
    
    try:
        # Check migrations if enabled
        if check_migrations_flag:
            logger.info("Checking database migrations...")
            try:
                # Call the migrate.py check function
                migrations_up_to_date = await asyncio.to_thread(check_migrations)
                if not migrations_up_to_date:
                    message = "Database migrations are not up-to-date. Run 'python migrate.py upgrade' to update."
                    validation_errors.append(message)
                    logger.error(message)
            except Exception as e:
                message = f"Error checking migrations: {str(e)}"
                validation_errors.append(message)
                logger.error(message)
        
        # Validate database schema
        logger.info("Validating database schema against ORM models...")
        schema_valid = await validate_database_schema(fail_on_error=False)  # Never fail here, collect errors instead
        
        if not schema_valid:
            message = "Database schema validation failed. Database schema does not match ORM models."
            validation_errors.append(message)
            logger.error(message)
        
        # If there are validation errors and we should fail, raise exception
        if validation_errors and fail_on_error:
            error_message = "Database validation failed:\n" + "\n".join(validation_errors)
            logger.error(error_message)
            raise HTTPException(status_code=500, detail=error_message)
        
        # Validation passed or errors were ignored
        if not validation_errors:
            logger.info("Database validation passed successfully.")
        
        # Yield control to FastAPI
        yield
    finally:
        # Cleanup (if needed)
        pass

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
        
        # Check migrations if enabled
        if check_migrations_flag:
            logger.info("Checking database migrations...")
            try:
                # Call the migrate.py check function 
                # Since check_migrations is a sync function, run it in a thread
                migrations_up_to_date = await asyncio.to_thread(check_migrations)
                if not migrations_up_to_date:
                    message = "Database migrations are not up-to-date. Run 'python migrate.py upgrade' to update."
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
            schema_valid = await validate_database_schema(fail_on_error=fail_on_error)
            if schema_valid:
                logger.info("Database validation passed successfully.")
        except Exception as e:
            logger.error(f"Database validation failed: {str(e)}")
            if fail_on_error:
                raise RuntimeError(f"Database validation failed: {str(e)}")
