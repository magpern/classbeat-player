"""What the live routes share: the live process's service (registry and pool) and the hub of
its WebSocket connections.

Set on the application when it starts (app.py), like `SiteState`.
"""

from __future__ import annotations

from typing import cast

from starlette.requests import HTTPConnection

from player_backend.live.hub import Hub
from player_backend.live.service import LiveService


def live_service(request: HTTPConnection) -> LiveService:
    return cast(LiveService, request.app.state.live)


def live_hub(connection: HTTPConnection) -> Hub:
    return cast(Hub, connection.app.state.live_hub)
