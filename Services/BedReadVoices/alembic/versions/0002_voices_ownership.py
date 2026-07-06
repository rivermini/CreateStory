"""Add TTS and BedRead ownership metadata."""

from alembic import op
import sqlalchemy as sa

revision = "0002_voices_owner"
down_revision = "0001_voices"
branch_labels = None
depends_on = None

TABLES = ("bedread_audio_jobs", "generated_audio_files")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in TABLES:
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "created_by_user_id" not in columns:
            op.add_column(table, sa.Column("created_by_user_id", sa.String(64), nullable=True))
            op.create_index(f"ix_{table}_created_by_user_id", table, ["created_by_user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in reversed(TABLES):
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "created_by_user_id" in columns:
            op.drop_index(f"ix_{table}_created_by_user_id", table_name=table)
            op.drop_column(table, "created_by_user_id")
