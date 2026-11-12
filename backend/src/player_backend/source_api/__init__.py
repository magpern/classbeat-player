"""The source API, `/api/source/` (ADR 0002, section 7).

These routes read no cookie. The code exchange takes the link code in the body of a POST; every
other route takes a source token in `Authorization: Bearer` and nothing else.
"""

from __future__ import annotations

from fastapi import APIRouter

from player_backend.source_api.publications import router as publications_router
from player_backend.source_api.token import router as token_router

router = APIRouter(prefix="/api/source")
router.include_router(token_router)
router.include_router(publications_router)
