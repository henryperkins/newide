"""add password reset columns with direct SQL

Revision ID: c2e7a8f9b1d5
Revises: b1f4a3c7d5e6
Create Date: 2025-03-14 13:13:00.000000

"""
from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = 'c2e7a8f9b1d5'
down_revision = 'b1f4a3c7d5e6'
branch_labels = None
depends_on = None


def upgrade():
    # Direct SQL approach for adding columns
    op.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS requires_password_reset BOOLEAN NOT NULL DEFAULT FALSE"))
    op.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_reason VARCHAR(255)"))


def downgrade():
    # Direct SQL approach for removing columns
    op.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS password_reset_reason"))
    op.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS requires_password_reset"))