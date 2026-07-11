"""Create AutoAudio-owned settings storage."""

from alembic import op

from core.db import Base
import core.db_models  # noqa: F401

revision = "0003_auto_settings"
down_revision = "0002_auto_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.tables["app_settings"].create(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.tables["app_settings"].drop(op.get_bind(), checkfirst=True)
