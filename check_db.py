import asyncio
from database import get_db_session
from services.config_service import ConfigService

async def check_models():
    try:
        db_gen = get_db_session()
        db = await anext(db_gen)
        service = ConfigService(db)
        models = await service.get_model_configs()
        print("Models found:")
        print(models)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(check_models())
