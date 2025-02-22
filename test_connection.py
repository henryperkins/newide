import asyncio
import ssl
from sqlalchemy import text
from database import get_db_session, engine
import config

async def test_database_connection():
    """Test database connectivity and SSL configuration"""
    print("\nTesting database connection...")
    print(f"Host: {config.settings.POSTGRES_HOST}")
    print(f"Database: {config.settings.POSTGRES_DB}")
    print(f"User: {config.settings.POSTGRES_USER}")
    
    try:
        # Test raw connection
        print("\n1. Testing SSL/TLS connection...")
        async with engine.begin() as conn:
            # Get SSL info
            result = await conn.execute(text("SHOW ssl"))
            ssl_status = result.scalar()
            print(f"SSL enabled: {ssl_status}")
            
            # Test basic query
            print("\n2. Testing basic query execution...")
            result = await conn.execute(text("SELECT version()"))
            version = result.scalar()
            print(f"PostgreSQL version: {version}")
            
            # Get current connection info
            print("\n3. Connection details:")
            result = await conn.execute(text("""
                SELECT 
                    a.client_addr,
                    a.client_port,
                    a.state
                FROM pg_stat_activity a
                WHERE a.pid = pg_backend_pid();
            """))
            row = result.one()
            print(f"Client address: {row.client_addr}")
            print(f"Client port: {row.client_port}")
            print(f"Connection state: {row.state}")
            
        print("\n✅ Database connection test successful!")
        
    except Exception as e:
        print("\n❌ Database connection test failed!")
        print(f"Error: {str(e)}")
        
        if "certificate verify failed" in str(e):
            print("\nCertificate verification error. Please check:")
            print("1. Root certificates are properly installed")
            print("2. SSL certificate paths are correct")
            print("3. Server hostname matches certificate")
            
        elif "timeout" in str(e).lower():
            print("\nConnection timeout. Please check:")
            print("1. Database server is running")
            print("2. Firewall rules allow connection")
            print("3. Network connectivity to server")
            
        elif "password authentication failed" in str(e):
            print("\nAuthentication failed. Please check:")
            print("1. Username is correct")
            print("2. Password is correct")
            print("3. User has proper permissions")
            
        raise

async def main():
    await test_database_connection()

if __name__ == "__main__":
    asyncio.run(main())