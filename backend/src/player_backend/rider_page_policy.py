"""Pure rules for the rider page at `/j` (ADR 0007, section 5): served like the companion page
at `/control` (control_page_policy.py), with the same headers.

- The same built files are served, by the same rule (`control_page_policy.asset_type`); the page
  itself (`index.html`) at `/j` only, never under its file name.
- The headers of every answer under `/j` are the companion's, key for key and value for value,
  but for `connect-src` in the content security policy: the rider page connects only to the
  join route and the live WebSocket, so it names those and nothing else. The join code is read
  from the address's fragment, which a browser never sends, so no request carries it.
"""

from __future__ import annotations

from typing import Final

from player_backend.control_page_policy import asset_type

RIDER_PATH: Final = "/j"

# Each fetch of the page: POST /api/live/join (ADR 0007, section 2), and its one WebSocket.
# Exact paths: a source path without a trailing `/` matches that path only.
_FETCHED: Final = ("/api/live/join",)
_LIVE_WS: Final = "/api/live/ws"


def is_rider_path(path: str) -> bool:
    """Whether the path is the page or anything under it (not `/join` or `/jx`)."""
    return path == RIDER_PATH or path.startswith(RIDER_PATH + "/")


def content_security_policy(site_origin: str) -> str:
    """The page's policy. `site_origin` is the site's `https://` origin (settings.py)."""
    socket_origin = "wss://" + site_origin.removeprefix("https://")
    connect = " ".join([*(site_origin + p for p in _FETCHED), socket_origin + _LIVE_WS])
    return (
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
        f"img-src 'self'; connect-src {connect}; base-uri 'none'; form-action 'self'; "
        "frame-ancestors 'none'; object-src 'none'"
    )


def is_asset_path(path: str) -> bool:
    """Whether a path under `/j` names a script, a style sheet or a font."""
    relative = path.removeprefix(RIDER_PATH + "/")
    return is_rider_path(path) and relative != path and asset_type(relative) is not None


def rider_headers(path: str, site_origin: str) -> dict[str, str]:
    """The headers of every answer under `/j`, found or not."""
    return {
        "Content-Security-Policy": content_security_policy(site_origin),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Cache-Control": "no-cache" if is_asset_path(path) else "no-store",
    }
