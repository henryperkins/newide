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
from typing import Dict, List, Tuple
from sqlalchemy import inspect, MetaData, Table, Column, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncConnection
import sqlalchemy.types as sqltypes

from models import Base
from database import engine
import database


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
        
        try:
            # Get SQLAlchemy inspector
            async with self.engine.connect() as conn:
                # Get database inspector using run_sync to handle async connection
                tables = await self._get_tables(conn)
                
                # Check for missing tables
                await self._validate_tables(tables)
                
                # Check columns for each table that exists in both ORM and DB
                await self._validate_columns(conn, tables)
                
                # Check indexes and foreign keys for tables that exist in both
                await self._validate_constraints(conn, tables)
            
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
            
        except Exception as e:
            logger.error(f"Error during schema validation: {str(e)}")
            if self.fail_on_error:
                raise
            return False, [str(e)], []
    
    async def _get_tables(self, conn: AsyncConnection) -> Dict[str, bool]:
        """
        Get all tables from the database using run_sync for async compatibility.
        
        Args:
            conn: AsyncConnection to the database
            
        Returns:
            Dictionary of table names mapping to whether they exist in DB
        """
        # Get all table names from ORM models
        orm_tables = set(self.metadata.tables.keys())
        
        # Get all table names from database
        db_tables = set(await conn.run_sync(lambda sync_conn: sync_conn.dialect.get_table_names(sync_conn)))
        
        # Create a dictionary of all tables and whether they exist in the database
        tables = {table: table in db_tables for table in orm_tables}
        tables.update({table: table in orm_tables for table in db_tables})
        
        return tables
    
    async def _validate_tables(self, tables: Dict[str, bool]) -> None:
        """
        Validate that all tables defined in ORM models exist in the database
        and vice versa.
        
        Args:
            tables: Dictionary mapping table names to whether they exist in DB
        """
        for table_name, exists_in_db in tables.items():
            # Check if table is in ORM models
            exists_in_orm = table_name in self.metadata.tables
            
            # Table in ORM but not in DB
            if exists_in_orm and not exists_in_db:
                self.errors.append(f"Table '{table_name}' is defined in ORM models but does not exist in database")
            
            # Table in DB but not in ORM
            elif not exists_in_orm and exists_in_db:
                # Skip alembic_version table if it exists
                if table_name == 'alembic_version':
                    continue
                self.warnings.append(f"Table '{table_name}' exists in database but is not defined in ORM models")
    
    async def _validate_columns(self, conn: AsyncConnection, tables: Dict[str, bool]) -> None:
        """
        Validate that columns in ORM models match columns in database tables.
        
        Args:
            conn: AsyncConnection to the database
            tables: Dictionary mapping table names to whether they exist in DB
        """
        # For each table in ORM models that also exists in DB
        for table_name, exists_in_db in tables.items():
            if not exists_in_db or table_name not in self.metadata.tables:
                continue
                
            # Get ORM table
            orm_table = self.metadata.tables[table_name]
            
            # Get database columns using run_sync for async compatibility
            try:
                # Use run_sync to get columns from sync inspector
                db_columns = await conn.run_sync(
                    lambda sync_conn: {
                        col["name"]: col for col in inspect(sync_conn).get_columns(table_name)
                    }
                )
            except Exception as e:
                self.warnings.append(f"Could not inspect columns for table '{table_name}': {str(e)}")
                continue
            
            # Check each column in the ORM model
            for orm_column in orm_table.columns:
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
                self._check_column_type(table_name, col_name, orm_column, dict(db_column))
            
            # Check for columns in database but not in ORM
            orm_column_names = {col.name for col in orm_table.columns}
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
    
    async def _validate_constraints(self, conn: AsyncConnection, tables: Dict[str, bool]) -> None:
        """
        Validate indexes and foreign keys in database tables.
        
        Args:
            conn: AsyncConnection to the database
            tables: Dictionary mapping table names to whether they exist in DB
        """
        # For each table in ORM models that also exists in DB
        for table_name, exists_in_db in tables.items():
            if not exists_in_db or table_name not in self.metadata.tables:
                continue
                
            # Get ORM table
            orm_table = self.metadata.tables[table_name]
            
            # Check indexes
            await self._validate_indexes(conn, table_name, orm_table)
            
            # Check foreign keys
            await self._validate_foreign_keys(conn, table_name, orm_table)
    
    async def _validate_indexes(self, conn: AsyncConnection, table_name: str, orm_table: Table) -> None:
        """
        Validate that indexes in ORM models match indexes in database.
        
        Args:
            conn: AsyncConnection to the database
            table_name: Name of the table to check
            orm_table: SQLAlchemy Table object for the table
        """
        try:
            # Get database indexes using run_sync
            db_indexes = await conn.run_sync(
                lambda sync_conn: inspect(sync_conn).get_indexes(table_name)
            )
            db_index_names = {idx["name"] for idx in db_indexes if idx["name"] is not None}
        except Exception as e:
            self.warnings.append(f"Could not inspect indexes for table '{table_name}': {str(e)}")
            return
        
        # Create a set of ORM index names
        orm_indexes = [idx for idx in orm_table.indexes]
        orm_index_names = {idx.name for idx in orm_indexes if idx.name is not None}
        
        # Check for missing indexes (warning only as some indexes may be generated with different names)
        for orm_idx in orm_indexes:
            if orm_idx.name and orm_idx.name not in db_index_names:
                # Skip primary key indexes which are handled separately
                if not any(col.primary_key for col in orm_idx.columns):
                    self.warnings.append(f"Index '{orm_idx.name}' on table '{table_name}' is defined in ORM but not found in database")
    
    async def _validate_foreign_keys(self, conn: AsyncConnection, table_name: str, orm_table: Table) -> None:
        """
        Validate that foreign keys in ORM models match foreign keys in database.
        
        Args:
            conn: AsyncConnection to the database
            table_name: Name of the table to check
            orm_table: SQLAlchemy Table object for the table
        """
        try:
            # Get database foreign keys using run_sync
            db_fks = await conn.run_sync(
                lambda sync_conn: inspect(sync_conn).get_foreign_keys(table_name)
            )
        except Exception as e:
            self.warnings.append(f"Could not inspect foreign keys for table '{table_name}': {str(e)}")
            return
        
        # Create a dictionary of database FKs for easier lookup
        db_fk_dict = {}
        for fk in db_fks:
            src_cols = tuple(fk.get('constrained_columns', []))
            referred_cols = tuple(fk.get('referred_columns', []))
            referred_table = fk.get('referred_table')
            if src_cols and referred_table and referred_cols:
                key = (src_cols, referred_table, referred_cols)
                db_fk_dict[key] = fk
        
        # Check each foreign key in ORM model
        for fk in orm_table.foreign_keys:
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
        for fk in orm_table.foreign_keys:
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
    try:
        validator = SchemaValidator(engine, Base.metadata, fail_on_error)
        passed, errors, warnings = await validator.validate_schema()
        
        # Additional data validation checks
        async with database.traced_session() as session:
            result = await session.execute(text("SELECT COUNT(*) FROM users"))
            # Fix: convert CursorResult to scalar value
            count = result.scalar()
            if count is not None:
                logger.debug(f"Found {count} users in database")
                
        return passed
    except Exception as e:
        logger.error(f"Error during database validation: {str(e)}")
        if fail_on_error:
            raise
        return False

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

