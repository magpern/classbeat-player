"""The live process (ADR 0002, section 8; ADR 0005; ADR 0007): sessions in memory, the host
token, the re-check and its listener, and the live routes under `/api/live/`. The backend runs
as one process on purpose (docker/backend-entrypoint.sh): the sessions live in its memory only.
"""

from __future__ import annotations

from player_backend.live.control_routes import router as control_router
from player_backend.live.join_route import router as join_router

# The routes' router, with the WebSocket route (live/ws.py) registered on it.
from player_backend.live.ws import router

# The controller routes (live/control_routes.py).
router.include_router(control_router)

# The riders' join route (live/join_route.py).
router.include_router(join_router)

__all__ = ["router"]
