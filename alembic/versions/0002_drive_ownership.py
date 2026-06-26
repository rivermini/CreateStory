"""Add DriveSync ownership and job version metadata."""

from alembic import op
import sqlalchemy as sa

revision = "0002_drive_owner"
down_revision = "0001_drive"
branch_labels = None
depends_on = None

OWNER_TABLES = (
    "drive_sync_history",
    "drive_sync_jobs",
    "cover_update_histories",
    "banner_update_histories",
    "intro_update_histories",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in OWNER_TABLES:
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "created_by_user_id" not in columns:
            op.add_column(table, sa.Column("created_by_user_id", sa.String(64), nullable=True))
            op.create_index(f"ix_{table}_created_by_user_id", table, ["created_by_user_id"])
    job_columns = {column["name"] for column in sa.inspect(bind).get_columns("drive_sync_jobs")}
    if "version" not in job_columns:
        op.add_column(
            "drive_sync_jobs",
            sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    job_columns = {column["name"] for column in inspector.get_columns("drive_sync_jobs")}
    if "version" in job_columns:
        op.drop_column("drive_sync_jobs", "version")
    for table in reversed(OWNER_TABLES):
        columns = {column["name"] for column in sa.inspect(bind).get_columns(table)}
        if "created_by_user_id" in columns:
            op.drop_index(f"ix_{table}_created_by_user_id", table_name=table)
            op.drop_column(table, "created_by_user_id")
