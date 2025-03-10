from alembic import context
from models import Base
target_metadata = Base.metadata
def run_migrations_online():
    connectable = context.config.attributes.get('connection', None)
    if connectable is None:
        from sqlalchemy import engine_from_config
        config_section = context.config.get_section(context.config.config_ini_section)
        connectable = engine_from_config(config_section if config_section else {})
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
