#!/usr/bin/env python
"""
Database fix script to identify users with invalid password hashes and mark them for password reset.

This script:
1. Checks all user accounts for invalid bcrypt_sha256 hashes
2. Flags affected accounts for password reset
3. Generates a report of affected users
"""

import asyncio
import sys
import os
import csv
from datetime import datetime
from passlib.hash import bcrypt_sha256
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# Add the root directory to the path so we can import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import User
import config
from logging_config import get_logger

# Set up logger
logger = get_logger(__name__)

async def main():
    # Create engine and session
    engine = create_async_engine(config.settings.DATABASE_URL)
    async_session = sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )
    
    logger.info("Starting invalid hash detection script")
    
    invalid_users = []
    updated_count = 0
    total_count = 0
    
    async with async_session() as session:
        # Get all users from the database
        result = await session.execute(select(User))
        users = result.scalars().all()
        total_count = len(users)
        
        logger.info(f"Checking {total_count} user accounts for invalid hashes")
        
        for user in users:
            # Skip users that are already flagged
            if hasattr(user, 'requires_password_reset') and user.requires_password_reset:
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
                    user.updated_at = datetime.utcnow()
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
                user.updated_at = datetime.utcnow()
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

if __name__ == "__main__":
    asyncio.run(main())