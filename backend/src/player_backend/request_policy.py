"""Pure rules for a request to the site's API (ADR 0002, sections 4 and 5).

- Cross-site requests: a state change needs an `Origin` header equal to the site's origin, and
  is refused when `Sec-Fetch-Site` is present and is not `same-origin`.
- The app's routes that take no credential (pairing): refused for a browser, which always
  sends `Sec-Fetch-Site`, and for a body that is not sent as `application/json`.
- Recent sign-in: sensitive actions need a sign-in within the last 10 minutes.
- The headers every response carries, and `Cache-Control: no-store` on the site's API, the
  pairing endpoints, the player API and the source API, whose responses carry tokens or an
  account's data.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from http import HTTPMethod
from typing import Final, Literal

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


def app_request_refusal(
    sec_fetch_site: str | None, content_type: str | None
) -> Literal["browser", "content_type"] | None:
    """Why a request to a route of the app that takes no credential is refused, or None.

    Those routes are for the desktop app alone. A browser sends `Sec-Fetch-Site` with every
    request and a page cannot set or remove it; the app's main process does not send it. So a
    request that has the header with any value but `none` (which a browser sends for what the
    user did themselves, never for a page's own request) comes from a page, and is refused.
    The body must be sent as `application/json`: a form of another site cannot send that, and
    a script of another origin cannot without a preflight, which is not answered.
    """
    if sec_fetch_site is not None and sec_fetch_site != "none":
        return "browser"
    media_type = (content_type or "").partition(";")[0].strip().lower()
    if media_type != "application/json":
        return "content_type"
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
