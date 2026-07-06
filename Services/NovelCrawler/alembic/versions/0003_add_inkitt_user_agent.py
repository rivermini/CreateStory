"""Add user_agent to inkitt_cookies.

Revision ID: 0003_add_inkitt_user_agent
Revises: 0002_crawler_owner
Down Revision: 0002_crawler_owner
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_add_inkitt_user_agent"
down_revision = "0002_crawler_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("inkitt_cookies")}
    if "user_agent" not in columns:
        op.add_column("inkitt_cookies", sa.Column("user_agent", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("inkitt_cookies")}
    if "user_agent" in columns:
        op.drop_column("inkitt_cookies", "user_agent")
