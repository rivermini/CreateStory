"""Add encrypted ReadNovelMtl session cookies.

Revision ID: 0008_add_readnovelmtl_cookies
Revises: 0007_add_novelhall_cookies
"""

from alembic import op

from api.db import Base
import api.models.db_models  # noqa: F401

revision = "0008_add_readnovelmtl_cookies"
down_revision = "0007_add_novelhall_cookies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["readnovelmtl_cookies"].create(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["readnovelmtl_cookies"].drop(bind, checkfirst=True)
