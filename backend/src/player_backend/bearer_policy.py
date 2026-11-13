"""Pure rules for the device token as a bearer token (ADR 0002, sections 3, 6 and 10).

- The player API takes one credential: `Authorization: Bearer cbp_dev_...`. Anything else is
  refused by its shape, before any lookup (principle 2). Cookies are not looked at.
- A device token that does not work is answered 401 with `token_revoked`, `token_unknown` or
  `token_expired` (section 6).
- The limits of section 10 for bearer tokens, counted in fixed windows by `rate_limit_hit`, and
  which of the device token's two budgets a request is counted against.
"""

from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Final, Literal

from player_backend.token_policy import is_token

type DeviceRefusal = Literal["revoked", "unknown", "expired"]

# Section 6: the answers to a device token that does not work, all 401.
REFUSAL_CODES: Final[dict[DeviceRefusal, str]] = {
    "revoked": "token_revoked",
    "unknown": "token_unknown",
    "expired": "token_expired",
}
# The same unknown or revoked token from one address: 20 per 5 minutes, then that token from
# that address is refused for 5 minutes without a lookup.
SAME_TOKEN_WINDOW: Final = timedelta(minutes=5)
SAME_TOKEN_MAX: Final = 20
COUNTED_PER_TOKEN: Final[frozenset[DeviceRefusal]] = frozenset({"revoked", "unknown"})
# Different unknown tokens from one address: 200 per 5 minutes, then a token that is not valid
# is refused until the window ends. Valid tokens from that address keep working.
UNKNOWN_WINDOW: Final = timedelta(minutes=5)
UNKNOWN_MAX: Final = 200
# Player API requests, per device token per minute: 600 reads of a class's document, 60 of
# everything else. Both are counted by `auth_enter_device` with these numbers as constants in its
# body (principle 7; migration 0009). Here they are what the tests hold the function to, and the
# window gives `Retry-After`.
REQUEST_WINDOW: Final = timedelta(minutes=1)
REQUEST_MAX: Final = 60
DOCUMENT_READ_MAX: Final = 600

# The budget a device-token request is counted against, as the function knows it.
type Budget = Literal["requests", "documents"]
# (method, route) of the reads of one class's document.
DOCUMENT_READS: Final = frozenset({("GET", "/api/player/classes/{class_id}")})


def bearer_device_token(authorization: str | None) -> str | None:
    """The device token of an `Authorization` header, or None when it holds no well-formed one.

    A token of another type, a malformed one and another scheme are all None: refused by
    shape, with nothing looked up.
    """
    if authorization is None:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return value if is_token("dev", value) else None


def same_token_key(token_hash: bytes, address_hash: bytes) -> bytes:
    """The counter of one token that does not work, from one address."""
    return hashlib.sha256(b"bearer.same:" + token_hash + address_hash).digest()


def unknown_tokens_key(address_hash: bytes) -> bytes:
    """The counter of unknown tokens from one address."""
    return hashlib.sha256(b"bearer.unknown:" + address_hash).digest()


def budget_of(method: str, route: str | None) -> Budget:
    """The budget of a request to `route` (its path template): a document read, or the rest.

    Anything not listed, an unknown route included, is counted against the smaller budget.
    """
    return "documents" if (method.upper(), route) in DOCUMENT_READS else "requests"


def requests_key(token_hash: bytes) -> bytes:
    """The counter of player API requests with one device token, as auth_enter_device makes it."""
    return hashlib.sha256(b"device.requests:" + token_hash).digest()


def documents_key(token_hash: bytes) -> bytes:
    """The counter of document reads with one device token, as auth_enter_device makes it."""
    return hashlib.sha256(b"device.documents:" + token_hash).digest()
