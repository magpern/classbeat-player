"""The site's API, `/api/site/` (ADR 0002, sections 4 and 5).

The only routes of the backend that read a cookie. Every state change is checked for its
origin, and every response is `Cache-Control: no-store`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from player_backend.site.deps import same_origin
from player_backend.site.sessions import router as sessions_router
from player_backend.site.sign_in import router as sign_in_router

router = APIRouter(prefix="/api/site", dependencies=[Depends(same_origin)])
router.include_router(sign_in_router)
router.include_router(sessions_router)
