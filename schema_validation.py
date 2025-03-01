"""
Database Schema Validation Utility

This module provides tools to validate that the SQLAlchemy ORM models match
the actual database schema. It can be used during application startup to
ensure database integrity and catch errors early.

Features:
- Validates table existence
- Validates column properties (name, type, nullability)
- Validates indexes and constraints
- Reports detailed information about mismatches
- Can be configured to fail on critical issues or just log warnings
"""

import sys
import logging
import asyncio
from typing import Dict, List, Set, Tuple, Optional, Any
from sqlalchemy import inspect, MetaData, Table, Column, text
from sqlalchemy.engine import Inspector
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.sql.schema import Index
import sqlalchemy.types as sqltypes

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import models and engine from project
from models import Base
from database import engine

class SchemaValidator:
    """
    Validates that SQLAlchemy ORM models match the actual database schema.
    """
    
    def __init__(self, engine: AsyncEngine, base_metadata: MetaData, fail_on_error: bool = False):
        """
        Initialize the schema validator.
        
        Args:
            engine: SQLAlchemy async engine
            base_metadata: SQLAlchemy metadata (typically Base.metadata)
            fail_on_error: If True, raise an exception on critical mismatches
        """
        self.engine = engine
        self.metadata = base_metadata
        self.fail_on_error = fail_on_error
        self.errors = []
        self.warnings = []
    
    async def validate_schema(self) -> Tuple[bool, List[str], List[str]]:
        """
        Validate that ORM models match the database schema.
        
        Returns:
            Tuple containing:
                - Boolean indicating if validation passed
                - List of error messages
                - List of warning messages
        """
        self.errors = []
        self.warnings = []
        
        # Get SQLAlchemy inspector
        async with self.engine.connect() as conn:
            # Get database inspector
            insp = inspect(conn)
            
            # Check for missing tables
            await self._validate_tables(insp)
            
            # Check columns for each table
            await self._validate_columns(insp)
            
            # Check indexes
            await self._validate_indexes(insp)
            
            # Check foreign keys
            await self._validate_foreign_keys(insp)
        
        # Determine overall validation result
        passed = len(self.errors) == 0
        
        # Log results
        if passed:
            if self.warnings:
                logger.warning("Schema validation completed with warnings:")
                for warning in self.warnings:
                    logger.warning(f"  - {warning}")
            else:
                logger.info("Schema validation completed successfully. ORM models match database schema.")
        else:
            logger.error("Schema validation failed. ORM models do not match database schema:")
            for error in self.errors:
                logger.error(f"  - {error}")
            
            if self.fail_on_error:
                error_message = "Database schema validation failed. See logs for details."
                logger.error(error_message)
                raise ValueError(error_message)
        
        return passed, self.errors, self.warnings
    
    async def _validate_tables(self, inspector: Inspector) -> None:
        """
        Validate that all tables defined in ORM models exist in the database
        and vice versa.
        
        Args:
            inspector: SQLAlchemy inspector
        """
        # Get all table names from database
        db_tables = set(await inspector.get_table_names())
        
        # Get all table names from ORM models
        orm_tables = set(self.metadata.tables.keys())
        
        # Check for tables in ORM but not in database
        missing_tables = orm_tables - db_tables
        for table_name in missing_tables:
            self.errors.append(f"Table '{table_name}' is defined in ORM models but does not exist in database")
        
        # Check for tables in database but not in ORM (warning only)
        extra_tables = db_tables - orm_tables
        for table_name in extra_tables:
            # Skip alembic_version table if it exists
            if table_name == 'alembic_version':
                continue
            self.warnings.append(f"Table '{table_name}' exists in database but is not defined in ORM models")
    
    async def _validate_columns(self, inspector: Inspector) -> None:
        """
        Validate that columns in ORM models match columns in database tables.
        
        Args:
            inspector: SQLAlchemy inspector
        """
        # For each table in ORM models
        for table_name, table in self.metadata.tables.items():
            # Skip if table doesn't exist in database
            try:
                db_columns = {col['name']: col for col in await inspector.get_columns(table_name)}
            except:
                continue
            
            # Check each column in the ORM model
            for orm_column in table.columns:
                col_name = orm_column.name
                
                # Check if column exists in database
                if col_name not in db_columns:
                    self.errors.append(f"Column '{col_name}' in table '{table_name}' is defined in ORM but not in database")
                    continue
                
                # Get database column
                db_column = db_columns[col_name]
                
                # Check nullability
                if orm_column.nullable != db_column['nullable']:
                    self.errors.append(
                        f"Column '{col_name}' in table '{table_name}' has different nullability: "
                        f"ORM={orm_column.nullable}, DB={db_column['nullable']}"
                    )
                
                # Check data type (basic compatibility check)
                self._check_column_type(table_name, col_name, orm_column, db_column)
            
            # Check for columns in database but not in ORM
            orm_column_names = {col.name for col in table.columns}
            for db_col_name in db_columns:
                if db_col_name not in orm_column_names:
                    self.warnings.append(f"Column '{db_col_name}' in table '{table_name}' exists in database but not in ORM")
    
    def _check_column_type(self, table_name: str, col_name: str, orm_column: Column, db_column: Dict) -> None:
        """
        Check if column types are compatible between ORM and database.
        This is a basic check and may need customization for specific column types.
        
        Args:
            table_name: Name of the table
            col_name: Name of the column
            orm_column: SQLAlchemy Column object from ORM
            db_column: Dictionary with column info from database
        """
        # Extract type names for comparison
        orm_type = orm_column.type
        db_type = db_column['type']
        
        # Basic type compatibility checks based on SQLAlchemy type hierarchy
        
        # String types
        if isinstance(orm_type, sqltypes.String):
            if 'char' not in str(db_type).lower() and 'text' not in str(db_type).lower() and 'varchar' not in str(db_type).lower():
                self.errors.append(
                    f"Column '{col_name}' in table '{table_name}' has incompatible types: "
                    f"ORM={orm_type}, DB={db_type}"
                )
        
        # Integer types
        elif isinstance(orm_type, sqltypes.Integer):
            if 'int' not in str(db_type).lower() and 'serial' not in str(db_type).lower():
                self.errors.append(
                    f"Column '{col_name}' in table '{table_name}' has incompatible types: "
                    f"ORM={orm_type}, DB={db_type}"
                )
        
        # Boolean types
        elif isinstance(orm_type, sqltypes.Boolean):
            if 'bool' not in str(db_type).lower():
                self.errors.append(
                    f"Column '{col_name}' in table '{table_name}' has incompatible types: "
                    f"ORM={orm_type}, DB={db_type}"
                )
        
        # Date/Time types
        elif isinstance(orm_type, sqltypes.DateTime):
            if 'timestamp' not in str(db_type).lower() and 'date' not in str(db_type).lower():
                self.errors.append(
                    f"Column '{col_name}' in table '{table_name}' has incompatible types: "
                    f"ORM={orm_type}, DB={db_type}"
                )
        
        # JSONB types (PostgreSQL specific)
        elif str(orm_type).lower() == 'jsonb':
            if 'json' not in str(db_type).lower():
                self.errors.append(
                    f"Column '{col_name}' in table '{table_name}' has incompatible types: "
                    f"ORM={orm_type}, DB={db_type}"
                )
    
    async def _validate_indexes(self, inspector: Inspector) -> None:
        """
        Validate that indexes in ORM models match indexes in database.
        
        Args:
            inspector: SQLAlchemy inspector
        """
        # For each table in ORM models
        for table_name, table in self.metadata.tables.items():
            # Skip if table doesn't exist in database
            try:
                db_indexes = await inspector.get_indexes(table_name)
                db_index_names = {idx['name'] for idx in db_indexes if idx['name'] is not None}
            except:
                continue
            
            # Create a set of ORM index names
            orm_indexes = [idx for idx in table.indexes]
            orm_index_names = {idx.name for idx in orm_indexes if idx.name is not None}
            
            # Some indexes might not have explicit names, so this is a best-effort check
            
            # Check for missing indexes (warning only as some indexes may be generated with different names)
            for orm_idx in orm_indexes:
                if orm_idx.name and orm_idx.name not in db_index_names:
                    # Skip primary key indexes which are handled separately
                    if not any(col.primary_key for col in orm_idx.columns):
                        self.warnings.append(f"Index '{orm_idx.name}' on table '{table_name}' is defined in ORM but not found in database")
            
            # We don't check for extra indexes in the DB as they might be created outside of the ORM
    
    async def _validate_foreign_keys(self, inspector: Inspector) -> None:
        """
        Validate that foreign keys in ORM models match foreign keys in database.
        
        Args:
            inspector: SQLAlchemy inspector
        """
        # For each table in ORM models
        for table_name, table in self.metadata.tables.items():
            # Skip if table doesn't exist in database
            try:
                db_fks = await inspector.get_foreign_keys(table_name)
            except:
                continue
            
            # Create a dictionary of database FKs for easier lookup
            db_fk_dict = {}
            for fk in db_fks:
                src_cols = tuple(fk['constrained_columns'])
                referred_cols = tuple(fk['referred_columns'])
                referred_table = fk['referred_table']
                key = (src_cols, referred_table, referred_cols)
                db_fk_dict[key] = fk
            
            # Check each foreign key in ORM model
            for fk in table.foreign_keys:
                col_name = fk.parent.name
                referred_table = fk.column.table.name
                referred_col = fk.column.name
                
                # Create a key for lookup
                key = ((col_name,), referred_table, (referred_col,))
                
                # Check if this foreign key exists in the database
                if key not in db_fk_dict:
                    self.errors.append(
                        f"Foreign key from '{table_name}.{col_name}' to '{referred_table}.{referred_col}' "
                        f"is defined in ORM but not in database"
                    )
            
            # Check for foreign keys in database but not in ORM
            orm_fks = set()
            for fk in table.foreign_keys:
                col_name = fk.parent.name
                referred_table = fk.column.table.name
                referred_col = fk.column.name
                orm_fks.add(((col_name,), referred_table, (referred_col,)))
            
            for key in db_fk_dict:
                if key not in orm_fks:
                    src_cols, referred_table, referred_cols = key
                    self.warnings.append(
                        f"Foreign key from '{table_name}.{src_cols}' to '{referred_table}.{referred_cols}' "
                        f"exists in database but not in ORM"
                    )


async def validate_database_schema(fail_on_error: bool = False) -> bool:
    """
    Validate that the database schema matches the ORM models.
    This function can be called during application startup.
    
    Args:
        fail_on_error: If True, raise an exception on critical mismatches
        
    Returns:
        Boolean indicating if validation passed
    """
    validator = SchemaValidator(engine, Base.metadata, fail_on_error)
    passed, errors, warnings = await validator.validate_schema()
    return passed

if __name__ == "__main__":
    """
    Run schema validation as a standalone script
    """
    # Get command line arguments
    import argparse
    parser = argparse.ArgumentParser(description="Validate database schema against ORM models")
    parser.add_argument("--fail", action="store_true", help="Fail on validation errors")
    args = parser.parse_args()
    
    # Run validation
    try:
        asyncio.run(validate_database_schema(args.fail))
    except Exception as e:
        logger.error(f"Schema validation failed: {e}")
        sys.exit(1)
