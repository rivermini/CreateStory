"""Add DriveSync-owned configuration, credentials, and persistent queue metadata."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0003_drive_queue"
down_revision = "0002_drive_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    for name in ("app_settings", "external_credentials"):
        Base.metadata.tables[name].create(bind, checkfirst=True)

    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("drive_sync_jobs")}
    additions = (
        ("payload", sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb"))),
        ("client_batch_id", sa.Column("client_batch_id", sa.String(128), nullable=True)),
        ("batch_item_index", sa.Column("batch_item_index", sa.Integer(), nullable=True)),
        ("attempt_count", sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0")),
        ("claimed_at", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True)),
        ("last_heartbeat_at", sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True)),
        ("last_error", sa.Column("last_error", sa.Text(), nullable=True)),
    )
    for name, column in additions:
        if name not in columns:
            op.add_column("drive_sync_jobs", column)

    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("drive_sync_jobs")}
    if "ix_drive_sync_jobs_client_batch_id" not in indexes:
        op.create_index("ix_drive_sync_jobs_client_batch_id", "drive_sync_jobs", ["client_batch_id"])
    constraints = {constraint["name"] for constraint in sa.inspect(bind).get_unique_constraints("drive_sync_jobs")}
    if "uq_drive_sync_jobs_batch_item" not in constraints:
        op.create_unique_constraint(
            "uq_drive_sync_jobs_batch_item",
            "drive_sync_jobs",
            ["client_batch_id", "batch_item_index"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    constraints = {constraint["name"] for constraint in sa.inspect(bind).get_unique_constraints("drive_sync_jobs")}
    if "uq_drive_sync_jobs_batch_item" in constraints:
        op.drop_constraint("uq_drive_sync_jobs_batch_item", "drive_sync_jobs", type_="unique")
    indexes = {index["name"] for index in sa.inspect(bind).get_indexes("drive_sync_jobs")}
    if "ix_drive_sync_jobs_client_batch_id" in indexes:
        op.drop_index("ix_drive_sync_jobs_client_batch_id", table_name="drive_sync_jobs")
    for name in reversed((
        "payload",
        "client_batch_id",
        "batch_item_index",
        "attempt_count",
        "claimed_at",
        "last_heartbeat_at",
        "last_error",
    )):
        columns = {column["name"] for column in sa.inspect(bind).get_columns("drive_sync_jobs")}
        if name in columns:
            op.drop_column("drive_sync_jobs", name)
    for name in ("external_credentials", "app_settings"):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
