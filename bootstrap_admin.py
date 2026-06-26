"""One-time CLI for creating the initial CreateStory administrator."""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

from pydantic import EmailStr, TypeAdapter

from api.auth import hash_password
from api.db import SessionLocal
from api.models.db_models import User
from api.repositories.auth_repository import AuthRepository, normalize_email


def _secret(name: str) -> str | None:
    value = os.getenv(name)
    if value:
        return value.strip()
    file_path = os.getenv(f"{name}_FILE")
    if file_path:
        return Path(file_path).read_text(encoding="utf-8").strip()
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the first administrator account.")
    parser.add_argument("--email", default=os.getenv("BOOTSTRAP_ADMIN_EMAIL"))
    args = parser.parse_args()

    email = args.email or input("Admin email: ").strip()
    try:
        email = str(TypeAdapter(EmailStr).validate_python(email))
    except ValueError as exc:
        print(f"Invalid email: {exc}", file=sys.stderr)
        return 2

    password = _secret("BOOTSTRAP_ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
    if len(password) < 12:
        print("Admin password must contain at least 12 characters.", file=sys.stderr)
        return 2

    with SessionLocal() as db:
        repo = AuthRepository(db)
        if repo.count_users() != 0:
            print("Refusing bootstrap: the users table is not empty.", file=sys.stderr)
            return 1
        db.add(
            User(
                email=normalize_email(email),
                password_hash=hash_password(password),
                role="admin",
                is_active=True,
            )
        )
        db.commit()

    print(f"Created administrator {normalize_email(email)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
