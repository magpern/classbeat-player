"""Pure rules of email link sign-in that the backend itself applies (ADR 0002, sections 4, 10).

The limits per email are counted inside `auth_request_login`. The one limit that does not
depend on the email, and so is the only one answered 429, is counted by the request before it.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Final

from player_backend.mail import Mail

EMAIL_MAX: Final = 254
ADDRESS_WINDOW: Final = timedelta(hours=1)
ADDRESS_MAX_REQUESTS: Final = 10
SIGN_IN_PATH: Final = "/sign-in"


def normalise_email(raw: str) -> str | None:
    """The email as an account holds it (trimmed, lower-cased), or None when it is not one."""
    email = raw.strip().lower()
    local, at, domain = email.rpartition("@")
    plain = email.isprintable() and not any(c.isspace() for c in email)
    if not (at and local and domain and plain and 3 <= len(email) <= EMAIL_MAX):
        return None
    return email


def address_limit_key(address_hash: bytes) -> bytes:
    """The counter of sign-in link requests from one address, whatever the email."""
    return hashlib.sha256(b"login.address:" + address_hash).digest()


def retry_after(now_epoch: float, window: timedelta = ADDRESS_WINDOW) -> int:
    """Seconds until the fixed window that `now_epoch` falls in ends: at least 1."""
    length = window.total_seconds()
    return max(1, int(length - now_epoch % length))


def sign_in_mail(site_origin: str, email: str, link_token: str) -> Mail:
    """The sign-in mail. The token is in the URL fragment, which is never sent to a server."""
    link = site_origin + SIGN_IN_PATH + "#" + link_token
    body = (
        "Open this link in the browser where you asked for it to sign in:\n\n"
        + link
        + "\n\nIt works once, for 15 minutes. If you did not ask for it, ignore this mail.\n"
    )
    return Mail(to=email, subject="Your sign-in link", body=body)
