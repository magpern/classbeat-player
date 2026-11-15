"""classbeat's server's routes, `/api/classbeat/` (ADR 0010, section 8).

Outside the site's API and its `Origin` rule: they read no cookie and take no credential but the
signed token in the body. A request from a browser is refused before anything else is done.
"""

from __future__ import annotations

from player_backend.classbeat_api.events import router

__all__ = ["router"]
