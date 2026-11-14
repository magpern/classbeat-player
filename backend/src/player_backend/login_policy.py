"""Pure rules of email link sign-in that the backend itself applies (ADR 0002, sections 4, 10;
ADR 0006, decisions 1 and 3; ADR 0008, section 3).

The limits per email are counted inside `auth_request_login`. The one limit that does not
depend on the email, and so is the only one answered 429, is counted by the request before it.
"""

from __future__ import annotations

import hashlib
import re
from datetime import timedelta
from typing import Final

from player_backend.code_policy import ALPHABET
from player_backend.mail import Mail

EMAIL_MAX: Final = 254
ADDRESS_WINDOW: Final = timedelta(hours=1)
ADDRESS_MAX_REQUESTS: Final = 10
SIGN_IN_PATH: Final = "/sign-in"

# The return entry a link request may carry (ADR 0006, decision 1, amended by ADR 0008,
# section 3): `control`, or `control.` and a class code exactly as shown, upper case with its
# hyphen; or `play`, or `play.` and a class id as a canonical lower-case uuid with its hyphens.
# Not `normalise_code`: nothing is folded, trimmed or filled in. Always matched as a whole.
_CODE_HALF = "[" + ALPHABET + "]{4}"
_CLASS_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
RETURN_ENTRY: Final = re.compile(
    r"control(\." + _CODE_HALF + "-" + _CODE_HALF + r")?|play(\." + _CLASS_ID + ")?"
)


def normalise_email(raw: str) -> str | None:
    """The email as an account holds it (trimmed, lower-cased), or None when it is not one."""
    email = raw.strip().lower()
    local, at, domain = email.rpartition("@")
    plain = email.isprintable() and not any(c.isspace() for c in email)
    if not (at and local and domain and plain and 3 <= len(email) <= EMAIL_MAX):
        return None
    return email


def is_return_entry(raw: str) -> bool:
    """Whether `raw` is, as a whole, a return entry the mailed link may carry."""
    return RETURN_ENTRY.fullmatch(raw) is not None


def address_limit_key(address_hash: bytes) -> bytes:
    """The counter of sign-in link requests from one address, whatever the email."""
    return hashlib.sha256(b"login.address:" + address_hash).digest()


def retry_after(now_epoch: float, window: timedelta = ADDRESS_WINDOW) -> int:
    """Seconds until the fixed window that `now_epoch` falls in ends: at least 1."""
    length = window.total_seconds()
    return max(1, int(length - now_epoch % length))


def sign_in_link(site_origin: str, link_token: str, return_to: str | None = None) -> str:
    """The mailed link. The token, and after it any return entry, is in the URL fragment, which
    is never sent to a server: `#<token>` or `#<token>&return=<return_to>` (ADR 0006, 3)."""
    fragment = link_token
    if return_to is not None:
        if not is_return_entry(return_to):
            raise ValueError("not a return entry")
        fragment += "&return=" + return_to
    return site_origin + SIGN_IN_PATH + "#" + fragment


def sign_in_mail(
    site_origin: str, email: str, link_token: str, return_to: str | None = None
) -> Mail:
    """The sign-in mail. Its text is the same with or without a return entry."""
    link = sign_in_link(site_origin, link_token, return_to)
    body = (
        "Open this link in the browser where you asked for it to sign in:\n\n"
        + link
        + "\n\nIt works once, for 15 minutes. If you did not ask for it, ignore this mail.\n"
    )
    return Mail(to=email, subject="Your sign-in link", body=body)
