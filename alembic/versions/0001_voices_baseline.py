"""Voices schema baseline."""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0001_voices"
down_revision = None
branch_labels = None
depends_on = None

OWNED_TABLES = ("bedread_audio_jobs", "generated_audio_files")


def upgrade() -> None:
    bind = op.get_bind()
    for name in OWNED_TABLES:
        Base.metadata.tables[name].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for name in reversed(OWNED_TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
