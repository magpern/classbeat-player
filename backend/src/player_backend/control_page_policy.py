"""Pure rules for the phone pages the backend serves: the handlebar companion at `/control`
(ADR 0005, sections 1 and 8; the companion spec, "Page hardening"), and the part it shares with
the rider page at `/j` (rider_page_policy.py; ADR 0007, section 5).

- Which built files are served, for both pages: a short allowlist of file types and plain
  lower-case names. A page itself (`index.html`) is served at its path only, never under its
  file name.
- The headers of every answer under a page's path, the same for both pages but for the routes
  it fetches: a content security policy with no third-party origin that lets the page connect
  to the live endpoint and the routes it calls and nothing else, `Referrer-Policy: no-referrer`
  (the fragment holds the join and control codes), `nosniff`, frame denial, and `no-store` on
  the page; its scripts, styles and fonts are revalidated.
- The companion fetches its three routes below; the rider page its one (rider_page_policy.py).
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

# Each fetch of the companion: POST /api/live/controller, POST /api/live/control, GET
# /api/site/sessions (web/src/companion/net.ts). Exact paths: a source path without a trailing
# `/` matches that path only.
_FETCHED: Final = ("/api/live/controller", "/api/live/control", "/api/site/sessions")
# Each page's one WebSocket (web/src/companion/socket.ts, and the rider page's).
_LIVE_WS: Final = "/api/live/ws"


def is_page_path(path: str, base: str) -> bool:
    """Whether the path is the page at `base` or anything under it (for `/control`, not
    `/controller` or `/controls`)."""
    return path == base or path.startswith(base + "/")


def is_control_path(path: str) -> bool:
    """Whether the path is the companion page or anything under it."""
    return is_page_path(path, CONTROL_PATH)


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


def page_policy(site_origin: str, routes: tuple[str, ...]) -> str:
    """A page's policy. `site_origin` is the site's `https://` origin (settings.py); `routes`
    holds the exact paths of the routes the page calls."""
    socket_origin = "wss://" + site_origin.removeprefix("https://")
    connect = " ".join([*(site_origin + p for p in routes), socket_origin + _LIVE_WS])
    return (
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
        f"img-src 'self'; connect-src {connect}; base-uri 'none'; form-action 'self'; "
        "frame-ancestors 'none'; object-src 'none'"
    )


def content_security_policy(site_origin: str) -> str:
    """The companion page's policy."""
    return page_policy(site_origin, _FETCHED)


def is_asset_path(path: str, base: str) -> bool:
    """Whether a path under the page at `base` names a script, a style sheet or a font."""
    relative = path.removeprefix(base + "/")
    return is_page_path(path, base) and relative != path and asset_type(relative) is not None


def page_headers(path: str, site_origin: str, base: str, routes: tuple[str, ...]) -> dict[str, str]:
    """The headers of every answer under the page at `base`, found or not."""
    return {
        "Content-Security-Policy": page_policy(site_origin, routes),
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Cache-Control": "no-cache" if is_asset_path(path, base) else "no-store",
    }


def control_headers(path: str, site_origin: str) -> dict[str, str]:
    """The headers of every answer under `/control`, found or not."""
    return page_headers(path, site_origin, CONTROL_PATH, _FETCHED)
