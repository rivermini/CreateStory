"""Add webnovel_cookies table.

Revision ID: 0005_add_webnovel_cookies
Revises: 0004_add_goodnovel_cookies
Down Revision: 0004_add_goodnovel_cookies
"""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0005_add_webnovel_cookies"
down_revision = "0004_add_goodnovel_cookies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["webnovel_cookies"].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["webnovel_cookies"].drop(bind, checkfirst=True)
