"""Pure rules for the handlebar companion page at `/control` (ADR 0005, sections 1 and 8; the
companion spec, "Page hardening").

- Which built files are served: a short allowlist of file types and plain lower-case names. The
  page itself (`index.html`) is served at `/control` only, never under its file name.
- The headers of every answer under `/control`: a content security policy with no third-party
  origin that lets the page connect to the live endpoint and the API it calls and nothing else,
  `Referrer-Policy: no-referrer` (the fragment holds the join and control codes), `nosniff`,
  frame denial, and `no-store` on the page; its scripts, styles and fonts are revalidated.
"""

from __future__ import annotations

import re
from typing import Final

CONTROL_PATH: Final = "/control"
PAGE_FILE: Final = "index.html"
PAGE_TYPE: Final = "text/html; charset=utf-8"
# The asset types the build writes (web/build.mjs) and nothing else: no source map, no HTML.
ASSET_TYPES: Final = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
}
# `companion.js`, `fonts/<name>.woff2`: at most one folder, plain lower-case segments.
_SEGMENT: Final = re.compile(r"[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*")
MAX_DEPTH: Final = 2

# Each fetch of the page: POST /api/live/controller, POST /api/live/control, GET
# /api/site/sessions (web/src/companion/net.ts), and its one WebSocket (socket.ts).
_LIVE_API: Final = "/api/live/"
_SESSIONS: Final = "/api/site/sessions"
_LIVE_WS: Final = "/api/live/ws"


def is_control_path(path: str) -> bool:
    """Whether the path is the page or anything under it (not `/controller` or `/controls`)."""
    return path == CONTROL_PATH or path.startswith(CONTROL_PATH + "/")


def asset_type(relative: str) -> str | None:
    """The media type a built file is served with, or None when it is not served at all.

    `relative` is the file's path inside the built folder, with `/` between segments.
    """
    segments = relative.split("/")
    if len(segments) > MAX_DEPTH or not all(_SEGMENT.fullmatch(s) for s in segments):
        return None
    name = segments[-1]
    dot = name.rfind(".")
    return ASSET_TYPES.get(name[dot:]) if dot > 0 else None


def content_security_policy(site_origin: str) -> str:
    """The page's policy. `site_origin` is the site's `https://` origin (settings.py)."""
    socket_origin = "wss://" + site_origin.removeprefix("https://")
    connect = f"{site_origin}{_LIVE_API} {site_origin}{_SESSIONS} {socket_origin}{_LIVE_WS}"
    return (
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
        f"img-src 'self'; connect-src {connect}; base-uri 'none'; form-action 'self'; "
        "frame-ancestors 'none'; object-src 'none'"
    )


def is_asset_path(path: str) -> bool:
    """Whether a path under `/control` names a script, a style sheet or a font."""
    relative = path.removeprefix(CONTROL_PATH + "/")
    return is_control_path(path) and relative != path and asset_type(relative) is not None


def control_headers(path: str, site_origin: str) -> dict[str, str]:
    """The headers of every answer under `/control`, found or not."""
    return {
        "Content-Security-Policy": content_security_policy(site_origin),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Cache-Control": "no-cache" if is_asset_path(path) else "no-store",
    }
