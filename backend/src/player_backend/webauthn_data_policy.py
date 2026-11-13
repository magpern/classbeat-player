"""Pure decoding of the WebAuthn data a browser sends (ADR 0002, section 4).

Binary fields in base64url, the credential id as the table can hold it, and the challenge as a
client's data names it. What is decoded here is checked after this (`webauthn_check`, the
sign-in functions). No I/O, and nothing here is ever logged.
"""

from __future__ import annotations

import base64
import binascii
import json
from typing import Final

from player_backend.passkey_policy import CHALLENGE_BYTES

# A credential id as the table holds it (0001_tables.sql).
CREDENTIAL_ID_MIN: Final = 16
CREDENTIAL_ID_MAX: Final = 1023


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
