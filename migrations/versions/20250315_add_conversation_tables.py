"""Add conversation_sessions and conversation_history tables

Revision ID: add_conversation_tables
Revises: modify_conversation_session_fk
Create Date: 2025-03-15 19:10:00
"""

revision = 'add_conversation_tables'
down_revision = 'modify_conversation_session_fk'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.dialects.postgresql import JSONB

def upgrade():
    op.create_table(
        'conversation_sessions',
        sa.Column('session_id', PGUUID, sa.ForeignKey('sessions.id', ondelete="CASCADE"), primary_key=True),
        sa.Column('conversation_id', sa.Integer, sa.ForeignKey('conversations.id', ondelete="CASCADE"), primary_key=True),
        sa.Column('context_snapshot', JSONB, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
    )

    op.create_table(
        'conversation_history',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('conversation_id', sa.Integer, sa.ForeignKey('conversations.id', ondelete="CASCADE")),
        sa.Column('content', sa.Text, nullable=False),
        sa.Column('version', sa.Integer, nullable=False, server_default='1'),
        sa.Column('valid_from', sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column('valid_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('azure_status', sa.String(20), nullable=True),
    )

def downgrade():
    op.drop_table('conversation_history')
    op.drop_table('conversation_sessions')