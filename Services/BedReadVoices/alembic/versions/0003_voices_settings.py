"""Create BedReadVoices-owned settings storage."""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0003_voices_settings"
down_revision = "0002_voices_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.tables["app_settings"].create(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.tables["app_settings"].drop(op.get_bind(), checkfirst=True)
