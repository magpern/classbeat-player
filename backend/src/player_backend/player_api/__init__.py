"""The app's side of the API: pairing (`/api/pairing/`) and the player API (`/api/player/`).

ADR 0002, sections 5 and 6: these routes read no cookie. Pairing takes the device code in the
body of a POST; the player API takes a device token in `Authorization: Bearer` and nothing else.
"""

from __future__ import annotations

from fastapi import APIRouter

from player_backend.player_api.device import router as device_router
from player_backend.player_api.pairing import router as pairing_router
from player_backend.player_api.sync import router as sync_router

router = APIRouter()
router.include_router(pairing_router)
router.include_router(device_router)
router.include_router(sync_router)
