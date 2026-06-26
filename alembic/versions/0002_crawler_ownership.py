"""Add crawl ownership metadata."""

from alembic import op
import sqlalchemy as sa

revision = "0002_crawler_owner"
down_revision = "0001_crawler"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("crawl_sessions")}
    if "created_by_user_id" not in columns:
        op.add_column("crawl_sessions", sa.Column("created_by_user_id", sa.String(64), nullable=True))
        op.create_index("ix_crawl_sessions_created_by_user_id", "crawl_sessions", ["created_by_user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("crawl_sessions")}
    if "created_by_user_id" in columns:
        op.drop_index("ix_crawl_sessions_created_by_user_id", table_name="crawl_sessions")
        op.drop_column("crawl_sessions", "created_by_user_id")
