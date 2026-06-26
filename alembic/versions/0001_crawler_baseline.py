"""Crawler schema baseline."""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0001_crawler"
down_revision = None
branch_labels = None
depends_on = None

OWNED_TABLES = (
    "crawl_sessions",
    "crawl_output_files",
    "inkitt_cookies",
    "scribblehub_cookies",
)


def upgrade() -> None:
    bind = op.get_bind()
    for name in OWNED_TABLES:
        Base.metadata.tables[name].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for name in reversed(OWNED_TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
