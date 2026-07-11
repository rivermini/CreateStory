"""Gateway schema baseline."""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0001_gateway"
down_revision = None
branch_labels = None
depends_on = None

OWNED_TABLES = (
    "users",
    "refresh_tokens",
    "app_settings",
    "shared_json_documents",
    "migration_audit",
)


def upgrade() -> None:
    bind = op.get_bind()
    for name in OWNED_TABLES:
        Base.metadata.tables[name].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    for name in reversed(OWNED_TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
