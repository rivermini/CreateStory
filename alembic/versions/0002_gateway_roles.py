"""Migrate legacy users to operator role."""

from alembic import op

revision = "0002_gateway_roles"
down_revision = "0001_gateway"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE users SET role = 'operator' WHERE role = 'user'")


def downgrade() -> None:
    op.execute("UPDATE users SET role = 'user' WHERE role = 'operator'")
