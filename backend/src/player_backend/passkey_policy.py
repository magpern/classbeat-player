"""Pure rules of passkeys that the backend itself applies (ADR 0002, sections 4 and 10).

The sign-in challenge's 5 minutes, its single use, its browser and the counter rule are checked
inside `auth_complete_passkey`. Here: the relying party, the numbers the backend uses, the
challenge as a client's data names it, the one limit counted by the request (failed sign-ins
per address) and the passkey's name. No I/O, and nothing here is ever logged.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass
from datetime import timedelta
from typing import Final
from urllib.parse import urlsplit

from player_backend.mail import Mail
from player_backend.pairing_policy import LABEL_MAX, clean_label

# A challenge is 32 random bytes, used once, for 5 minutes (section 4). The sign-in
# challenge's lifetime is the database's; the registration's is written by the backend.
CHALLENGE_BYTES: Final = 32
CHALLENGE_SECONDS: Final = 300
# At most 10 passkeys per account (section 4).
PASSKEYS_MAX: Final = 10
# Section 10: failed passkey sign-ins, 10 per address per 10 minutes, then 429.
FAILED_WINDOW: Final = timedelta(minutes=10)
FAILED_MAX: Final = 10
# A credential id as the table holds it (0001_tables.sql).
CREDENTIAL_ID_MIN: Final = 16
CREDENTIAL_ID_MAX: Final = 1023
NAME_MAX: Final = LABEL_MAX
RP_NAME: Final = "Class player"


@dataclass(frozen=True)
class NewPasskey:
    """A passkey whose registration checked out, as it is stored."""

    credential_id: bytes
    public_key: bytes
    sign_count: int
    transports: tuple[str, ...]


def rp_id_of(site_origin: str) -> str:
    """The relying party's id: the site's host name, from the one origin setting."""
    host = urlsplit(site_origin).hostname
    if not host:
        raise ValueError("the site origin has no host name")
    return host


def challenge_hash(challenge: bytes) -> bytes:
    """What the server stores of a challenge: its SHA-256, as for every token (section 2)."""
    return hashlib.sha256(challenge).digest()


def failed_limit_key(address_hash: bytes) -> bytes:
    """The counter of failed passkey sign-ins from one address."""
    return hashlib.sha256(b"passkey.failed:" + address_hash).digest()


def from_base64url(text: object) -> bytes | None:
    """Base64url, with or without padding, as WebAuthn's JSON writes binary; None otherwise."""
    if not isinstance(text, str) or not text.isascii():
        return None
    try:
        # A character outside base64 is refused, not skipped. `+`, `/`, padding and unused
        # trailing bits are accepted: the library compares `id` with `rawId` re-encoded.
        return base64.b64decode(text + "=" * (-len(text) % 4), altchars=b"-_", validate=True)
    except (binascii.Error, ValueError):
        return None


def credential_id_of(raw_id: object) -> bytes | None:
    """A credential id the table can hold, from the credential's `rawId`, or None."""
    found = from_base64url(raw_id)
    if found is None or not CREDENTIAL_ID_MIN <= len(found) <= CREDENTIAL_ID_MAX:
        return None
    return found


def challenge_of(client_data_json: object) -> bytes | None:
    """The challenge a client's data names, or None when it names none of ours.

    That is the case when the data is not a JSON object, the challenge is not 32 bytes, or
    the ceremony ran in a frame of another origin (`crossOrigin`), which the site never asks
    for. The signature over the data, and that the challenge is ours, are checked after this.
    """
    data = from_base64url(client_data_json)
    if data is None:
        return None
    try:
        parsed: object = json.loads(data)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    fields: dict[str, object] = parsed  # pyright: ignore[reportUnknownVariableType]
    if fields.get("crossOrigin", False) is not False:
        return None
    challenge = from_base64url(fields.get("challenge"))
    if challenge is None or len(challenge) != CHALLENGE_BYTES:
        return None
    return challenge


def added_mail(site_origin: str, email: str) -> Mail:
    """The notice that a passkey was added (section 6). It holds no challenge, no credential
    id and no key, and not the name the user typed."""
    body = (
        "A new passkey was added to your account and can now sign in to it.\n\n"
        "If this was not you, sign in at " + site_origin + " and remove it under Passkeys.\n"
    )
    return Mail(to=email, subject="A new passkey was added", body=body)


def clean_name(raw: object) -> str | None:
    """A passkey's name, 1 to 40 characters once control characters are removed, or None."""
    return clean_label(raw)
