"""Add encrypted NovelHall session cookies.

Revision ID: 0007_add_novelhall_cookies
Revises: 0006_add_jobnib_cookies
"""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0007_add_novelhall_cookies"
down_revision = "0006_add_jobnib_cookies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["novelhall_cookies"].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["novelhall_cookies"].drop(bind, checkfirst=True)
