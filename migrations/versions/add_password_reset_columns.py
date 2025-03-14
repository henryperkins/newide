"""add password reset columns

Revision ID: b1f4a3c7d5e6
Revises: modify_conversation_session_fk
Create Date: 2025-03-14 13:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b1f4a3c7d5e6'
down_revision = 'modify_conversation_session_fk'
branch_labels = None
depends_on = None


def upgrade():
    # Add requires_password_reset column with default value of False
    op.add_column('users', sa.Column('requires_password_reset', sa.Boolean(), 
                                     server_default='false', nullable=False))
    
    # Add password_reset_reason column as nullable string
    op.add_column('users', sa.Column('password_reset_reason', sa.String(), 
                                     nullable=True))


def downgrade():
    # Remove the columns in reverse order
    op.drop_column('users', 'password_reset_reason')
    op.drop_column('users', 'requires_password_reset')