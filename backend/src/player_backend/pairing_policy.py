"""Pure rules of pairing a device that the backend itself applies (ADR 0002, sections 6, 10).

The pairing's lifetime, the poll interval, the wrong-code limit and the cap on devices are
checked inside the `auth_*` functions. Here: what the app is told, the one limit counted by the
request (pairing starts per address), the text a person gives, and the mail about a new device.
"""

from __future__ import annotations

import hashlib
import unicodedata
from datetime import timedelta
from typing import Final

from player_backend.mail import Mail

# What `POST /api/pairing/start` tells the app: the same numbers as in the functions.
EXPIRES_IN: Final = 600
INTERVAL: Final = 5
PAIR_PATH: Final = "/pair"
START_WINDOW: Final = timedelta(hours=1)
START_MAX: Final = 10
# A device's name, a platform and a version: 1 to 40 characters.
LABEL_MAX: Final = 40
# How often a start asks again with new codes when a code is still in use by another pairing.
START_TRIES: Final = 3

# The poll's answers that are not the token, as the app gets them.
POLL_REFUSALS: Final = frozenset(
    {"authorization_pending", "slow_down", "access_denied", "expired_token"}
)
POLL_OK: Final = "ok"

# Removed from text a person or an app gives: control and format characters (bidi overrides
# and zero-width characters among them), unassigned and private ones, line separators.
_REMOVED: Final = frozenset({"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp"})


def start_limit_key(address_hash: bytes) -> bytes:
    """The counter of pairing starts from one address."""
    return hashlib.sha256(b"pairing.start:" + address_hash).digest()


def clean_label(raw: object) -> str | None:
    """A name, platform or version with control characters removed, or None when it is not
    1 to 40 characters after that. Always rendered as text by whoever shows it."""
    if not isinstance(raw, str) or len(raw) > 10 * LABEL_MAX:
        return None
    kept = "".join(c for c in raw if unicodedata.category(c) not in _REMOVED).strip()
    return kept if 1 <= len(kept) <= LABEL_MAX else None


def poll_refusal(state: object) -> str:
    """The answer for a poll that gives no token. Anything unexpected is `expired_token`."""
    return state if isinstance(state, str) and state in POLL_REFUSALS else "expired_token"


def pairing_page(site_origin: str) -> str:
    """The address the app opens. The code is typed there: it is never in the address."""
    return site_origin + PAIR_PATH


def paired_mail(site_origin: str, email: str) -> Mail:
    """The notice that a device was paired. It holds no token and no code."""
    body = (
        "A new device was paired with your account and can now read your classes.\n\n"
        "If this was not you, sign in at " + site_origin + " and revoke it under Devices.\n"
    )
    return Mail(to=email, subject="A new device was paired", body=body)
