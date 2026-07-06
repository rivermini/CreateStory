"""AutoAudio schema baseline."""

from alembic import op

from core.db import Base
import core.db_models  # noqa: F401

revision = "0001_auto_audio"
down_revision = None
branch_labels = None
depends_on = None

OWNED_TABLES = ("auto_audio_sessions", "auto_audio_completed_stories")


def upgrade() -> None:
    bind = op.get_bind()
    for name in OWNED_TABLES:
        Base.metadata.tables[name].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for name in reversed(OWNED_TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
