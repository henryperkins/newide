#!/usr/bin/env python
"""
Simplified database fix script to identify users with invalid password hashes.

This script:
1. Creates a direct database connection without SSL
2. Checks all user accounts for invalid bcrypt_sha256 hashes
3. Flags affected accounts for password reset
4. Generates a report of affected users
"""

import asyncio
import sys
import os
import csv
import logging
from datetime import datetime
from passlib.hash import bcrypt_sha256
from sqlalchemy import select, Column, String, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Add the root directory to the path so we can import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import config only
import config  # noqa: E402

# Set up logger 
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('hash_fix.log')
    ]
)
logger = logging.getLogger(__name__)

# Define a simplified User model
Base = declarative_base()

class User(Base):
    """Simplified User model for the script only."""
    __tablename__ = "users"
    id = Column(PGUUID, primary_key=True)
    email = Column(String(120), unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    requires_password_reset = Column(Boolean, default=False)
    password_reset_reason = Column(String)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)

async def main():
    """Main function to find and fix invalid password hashes."""
    engine = None
    try:
        logger.info("Starting simplified hash fix script")
        
        # Create a direct connection - intentionally skipping SSL for this script
        connection_string = (
            f"postgresql+asyncpg://{config.settings.POSTGRES_USER}:{config.settings.POSTGRES_PASSWORD}"
            f"@{config.settings.POSTGRES_HOST}:{config.settings.POSTGRES_PORT}/{config.settings.POSTGRES_DB}"
        )
        
        logger.info("Creating database connection")
        engine = create_async_engine(connection_string, echo=False)
        
        # Create async session factory
        async_session_factory = sessionmaker(
            bind=engine, 
            expire_on_commit=False, 
            class_=AsyncSession
        )
        
        invalid_users = []
        updated_count = 0
        total_count = 0
        
        # Use the async session with proper context manager
        async with async_session_factory() as session:
            # Get all users from the database
            logger.info("Fetching users")
            result = await session.execute(select(User))
            users = result.scalars().all()
            total_count = len(users)
            
            logger.info(f"Checking {total_count} user accounts for invalid hashes")
            
            for user in users:
                # Skip users that are already flagged for password reset
                if user.requires_password_reset:
                    continue
                    
                # Check if the hash is valid
                try:
                    if user.hashed_password:
                        bcrypt_sha256.identify(str(user.hashed_password))
                    else:
                        # Handle empty password hash
                        logger.warning(f"User {user.id} has empty password hash")
                        invalid_users.append({
                            'id': str(user.id),
                            'email': user.email,
                            'reason': 'Empty password hash'
                        })
                        
                        # Flag user for password reset
                        user.requires_password_reset = True
                        user.password_reset_reason = "Empty password hash detected"
                        updated_count += 1
                except Exception as e:
                    # Invalid hash detected
                    logger.warning(f"Invalid hash detected for user {user.id}: {str(e)}")
                    invalid_users.append({
                        'id': str(user.id),
                        'email': user.email,
                        'reason': f'Invalid hash format: {str(e)}'
                    })
                    
                    # Flag user for password reset
                    user.requires_password_reset = True
                    user.password_reset_reason = "Invalid hash format detected by script"
                    updated_count += 1
            
            # Commit changes if any users were updated
            if updated_count > 0:
                logger.info(f"Committing changes for {updated_count} users")
                await session.commit()
                
        # Generate a report of affected users
        if invalid_users:
            report_file = f"invalid_hash_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            logger.info(f"Generating report of {len(invalid_users)} affected users: {report_file}")
            
            with open(report_file, 'w', newline='') as csvfile:
                fieldnames = ['id', 'email', 'reason']
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                writer.writeheader()
                for user in invalid_users:
                    writer.writerow(user)
            
        logger.info(f"Scan complete. Found {len(invalid_users)} users with invalid hashes out of {total_count} total users.")
    
    except Exception as e:
        logger.error(f"Error running hash fix script: {str(e)}")
        raise
    finally:
        # Clean up connection
        if engine is not None:
            await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
