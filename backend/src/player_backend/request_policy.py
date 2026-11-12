"""Pure rules for a request to the site's API (ADR 0002, sections 4 and 5).

- Cross-site requests: a state change needs an `Origin` header equal to the site's origin, and
  is refused when `Sec-Fetch-Site` is present and is not `same-origin`.
- Recent sign-in: sensitive actions need a sign-in within the last 10 minutes.
- The headers every response carries, and `Cache-Control: no-store` on the site's API, the
  pairing endpoints, the player API and the source API, whose responses carry tokens or an
  account's data.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from http import HTTPMethod
from typing import Final

SITE_API: Final = "/api/site/"
NEVER_STORED: Final = (SITE_API, "/api/pairing/", "/api/player/", "/api/source/")
STATE_CHANGING: Final = frozenset(
    {HTTPMethod.POST, HTTPMethod.PUT, HTTPMethod.PATCH, HTTPMethod.DELETE}
)
RECENT_SIGN_IN: Final = timedelta(minutes=10)

CONTENT_SECURITY_POLICY: Final = (
    "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)


def cross_site_refusal(
    method: str, origin: str | None, sec_fetch_site: str | None, site_origin: str
) -> str | None:
    """Why a request is refused as cross-site, or None when it may go on."""
    if method.upper() not in STATE_CHANGING:
        return None
    if origin is None or origin != site_origin:
        return "origin"
    if sec_fetch_site is not None and sec_fetch_site != "same-origin":
        return "sec_fetch_site"
    return None


def is_recent_sign_in(signed_in_at: datetime, now: datetime) -> bool:
    """Whether the user proved who they are within the last 10 minutes."""
    return timedelta(0) <= now - signed_in_at <= RECENT_SIGN_IN


def response_headers(path: str) -> dict[str, str]:
    """The headers of every response; the APIs that carry tokens or data are never stored."""
    headers = {
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Referrer-Policy": "no-referrer",
    }
    if path.startswith(NEVER_STORED):
        headers["Cache-Control"] = "no-store"
    return headers
