"""Add goodnovel_cookies table.

Revision ID: 0004_add_goodnovel_cookies
Revises: 0003_add_inkitt_user_agent
Down Revision: 0003_add_inkitt_user_agent
"""
from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0004_add_goodnovel_cookies"
down_revision = "0003_add_inkitt_user_agent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["goodnovel_cookies"].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["goodnovel_cookies"].drop(bind, checkfirst=True)
