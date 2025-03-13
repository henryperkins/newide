"""Change ondelete behavior for conversation_session_id foreign key

Revision ID: modify_conversation_session_fk
Revises: <previous_revision_id>
Create Date: 2023-12-14 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'modify_conversation_session_fk'
down_revision = '<previous_revision_id>'  # Replace with actual previous revision
branch_labels = None
depends_on = None


def upgrade():
    # Drop the existing foreign key constraint
    op.drop_constraint('conversations_session_id_fkey', 'conversations', type_='foreignkey')
    
    # Create a new foreign key constraint with RESTRICT ondelete behavior
    op.create_foreign_key(
        'conversations_session_id_fkey',
        'conversations', 'sessions',
        ['session_id'], ['id'],
        ondelete='RESTRICT'
    )


def downgrade():
    # Drop the RESTRICT foreign key constraint
    op.drop_constraint('conversations_session_id_fkey', 'conversations', type_='foreignkey')
    
    # Recreate the original CASCADE foreign key constraint
    op.create_foreign_key(
        'conversations_session_id_fkey',
        'conversations', 'sessions',
        ['session_id'], ['id'],
        ondelete='CASCADE'
    )