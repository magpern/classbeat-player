"""What the live routes share: the live process's service (registry and pool).

Set on the application when it starts (app.py), like `SiteState`.
"""

from __future__ import annotations

from typing import cast

from fastapi import Request

from player_backend.live.service import LiveService


def live_service(request: Request) -> LiveService:
    return cast(LiveService, request.app.state.live)
