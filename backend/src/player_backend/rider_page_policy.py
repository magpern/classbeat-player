"""Pure rules for the rider page at `/j` (ADR 0007, section 5): served like the companion page
at `/control`, by the rules the two share (control_page_policy.py).

- The same built files are served, by the same rule (`control_page_policy.asset_type`); the page
  itself (`index.html`) at `/j` only, never under its file name.
- The headers of every answer under `/j` are the companion's, key for key and value for value,
  but for `connect-src` in the content security policy: the rider page connects only to the
  join route and the live WebSocket, so it names those and nothing else. The join code is read
  from the address's fragment, which a browser never sends, so no request carries it.
"""

from __future__ import annotations

from typing import Final

from player_backend.control_page_policy import is_page_path, page_headers, page_policy

RIDER_PATH: Final = "/j"

# Each fetch of the page: POST /api/live/join (ADR 0007, section 2); its one WebSocket is the
# companion's. Exact paths: a source path without a trailing `/` matches that path only.
_FETCHED: Final = ("/api/live/join",)


def is_rider_path(path: str) -> bool:
    """Whether the path is the page or anything under it (not `/join` or `/jx`)."""
    return is_page_path(path, RIDER_PATH)


def content_security_policy(site_origin: str) -> str:
    """The page's policy. `site_origin` is the site's `https://` origin (settings.py)."""
    return page_policy(site_origin, _FETCHED)


def rider_headers(path: str, site_origin: str) -> dict[str, str]:
    """The headers of every answer under `/j`, found or not."""
    return page_headers(path, site_origin, RIDER_PATH, _FETCHED)
