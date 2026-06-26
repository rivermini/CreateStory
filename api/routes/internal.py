"""Private APIs used only by trusted CreateStory services."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.config import load_external_api_config
from api.db import get_db
from api.internal_auth import require_internal_service

router = APIRouter(
    prefix="/internal/v1",
    tags=["Internal"],
    dependencies=[Depends(require_internal_service)],
    include_in_schema=False,
)


@router.get("/bedread/external-api-config")
def get_bedread_external_api_config(
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, str]:
    config = load_external_api_config(db)
    return {
        "external_api_base_url": config["main_be_api_base_url"],
        "external_api_token": config["main_be_bearer_token"],
    }
