"""The live process (ADR 0002, section 8; ADR 0005): sessions in memory, the host token, the
re-check and its listener, and the live routes under `/api/live/`. The backend runs as one
process on purpose (docker/backend-entrypoint.sh): the sessions live in its memory only.
"""

from __future__ import annotations

# The routes' router, with the WebSocket route (live/ws.py) registered on it.
from player_backend.live.ws import router

__all__ = ["router"]
