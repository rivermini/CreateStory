"""Add encrypted Jobnib session cookies.

Revision ID: 0006_add_jobnib_cookies
Revises: 0005_add_webnovel_cookies
"""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0006_add_jobnib_cookies"
down_revision = "0005_add_webnovel_cookies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["jobnib_cookies"].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["jobnib_cookies"].drop(bind, checkfirst=True)
