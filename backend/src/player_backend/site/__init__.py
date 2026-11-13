"""The site's API, `/api/site/` (ADR 0002, sections 4, 5, 6, 7 and 12).

The only routes of the backend that read a cookie. Every state change is checked for its
origin, and every response is `Cache-Control: no-store`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from player_backend.site.classes import router as classes_router
from player_backend.site.deps import same_origin
from player_backend.site.devices import router as devices_router
from player_backend.site.pairing import router as pairing_router
from player_backend.site.sessions import router as sessions_router
from player_backend.site.sign_in import router as sign_in_router
from player_backend.site.source_links import router as source_links_router

router = APIRouter(prefix="/api/site", dependencies=[Depends(same_origin)])
router.include_router(sign_in_router)
router.include_router(sessions_router)
router.include_router(pairing_router)
router.include_router(devices_router)
router.include_router(source_links_router)
router.include_router(classes_router)
