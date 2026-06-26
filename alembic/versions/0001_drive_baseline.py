"""DriveSync schema baseline."""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0001_drive"
down_revision = None
branch_labels = None
depends_on = None

OWNED_TABLES = (
    "drive_sync_status",
    "drive_sync_history",
    "drive_sync_jobs",
    "cover_update_histories",
    "banner_update_histories",
    "intro_update_histories",
)


def upgrade() -> None:
    bind = op.get_bind()
    for name in OWNED_TABLES:
        Base.metadata.tables[name].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for name in reversed(OWNED_TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
