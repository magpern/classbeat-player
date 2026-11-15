"""The full check of a classbeat ID token (ADR 0010, section 3) and of an event token (section
8): its form, the header, the key, the ES256 signature, then the claims. No I/O: the key set is
handed in.

The order is fixed: the header is checked before any key is looked at, and the signature before
any claim is read. A refusal is a `TokenRefused` with a fixed reason, never a value of the token.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from collections.abc import Callable, Sequence
from typing import Final, cast

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.hashes import SHA256

from player_backend.classbeat_event_policy import LOGOUT_TYPE, Event, event_of, event_refusal
from player_backend.classbeat_policy import (
    Identity,
    Json,
    claims_refusal,
    header_refusal,
    identity_of,
    select_key,
)

# Far above an ID token's size; a longer one is not read.
TOKEN_MAX: Final = 16 * 1024
_SIGNATURE_BYTES: Final = 64
# base64url without padding, and nothing else: no character is skipped when decoding.
_PART: Final = re.compile(r"[A-Za-z0-9_-]+")

# The key set as cached: the keys, and a way to ask for one more fetch for an unknown `kid`.
type KeyLookup = Callable[[str], Sequence[Json]]


class TokenRefused(ValueError):
    """The ID token is refused. `reason` is a fixed word."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _decode(part: str) -> bytes:
    if _PART.fullmatch(part) is None:
        raise TokenRefused("form")
    try:
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    except (binascii.Error, ValueError):
        raise TokenRefused("form") from None


def _no_constant(_name: str) -> object:
    # `NaN`, `Infinity` and `-Infinity` are not JSON.
    raise ValueError("not JSON")


def _object(part: str) -> Json:
    try:
        value: object = json.loads(_decode(part), parse_constant=_no_constant)
    except (UnicodeDecodeError, ValueError):
        raise TokenRefused("form") from None
    if not isinstance(value, dict):
        raise TokenRefused("form")
    return cast(Json, value)


def _coordinate(text: object) -> int:
    raw = _decode(text) if isinstance(text, str) else b""
    if len(raw) != 32:
        raise TokenRefused("key")
    return int.from_bytes(raw, "big")


def _public_key(key: Json) -> ec.EllipticCurvePublicKey:
    numbers = ec.EllipticCurvePublicNumbers(
        _coordinate(key.get("x")), _coordinate(key.get("y")), ec.SECP256R1()
    )
    try:
        return numbers.public_key()
    except ValueError:
        raise TokenRefused("key") from None


def _verify(key: Json, signing_input: bytes, signature: bytes) -> None:
    if len(signature) != _SIGNATURE_BYTES:
        raise TokenRefused("signature")
    r = int.from_bytes(signature[:32], "big")
    s = int.from_bytes(signature[32:], "big")
    try:
        _public_key(key).verify(encode_dss_signature(r, s), signing_input, ec.ECDSA(SHA256()))
    except InvalidSignature:
        raise TokenRefused("signature") from None


def verified_claims(token: str, keys: KeyLookup, required_type: str | None = None) -> Json:
    """The claims of a token whose form, header, key and signature pass, or `TokenRefused`.

    `required_type` is the header's `typ` an event token must have (section 8); None for an ID
    token. No claim is read before the signature has been checked.
    """
    if len(token) > TOKEN_MAX or not token.isascii():
        raise TokenRefused("form")
    parts = token.split(".")
    if len(parts) != 3:
        raise TokenRefused("form")
    header = _object(parts[0])
    refusal = header_refusal(header, required_type)
    if refusal is not None:
        raise TokenRefused(refusal)
    kid = cast(str, header["kid"])
    key = select_key(keys(kid), kid)
    if key is None:
        raise TokenRefused("kid")
    _verify(key, (parts[0] + "." + parts[1]).encode("ascii"), _decode(parts[2]))
    return _object(parts[1])


def check_id_token(
    token: str,
    keys: KeyLookup,
    *,
    issuer: str,
    client_id: str,
    expected_nonce_hash: bytes,
    now: int,
) -> Identity:
    """The identity of a token that passes every check, or `TokenRefused`."""
    claims = verified_claims(token, keys)
    refusal = claims_refusal(
        claims, issuer=issuer, client_id=client_id, expected_nonce_hash=expected_nonce_hash, now=now
    )
    if refusal is not None:
        raise TokenRefused(refusal)
    return identity_of(claims)


def check_event_token(
    token: str, keys: KeyLookup, *, issuer: str, client_id: str, now: int
) -> Event:
    """The event of a `logout+jwt` token that passes every check, or `TokenRefused`."""
    claims = verified_claims(token, keys, LOGOUT_TYPE)
    refusal = event_refusal(claims, issuer=issuer, client_id=client_id, now=now)
    if refusal is not None:
        raise TokenRefused(refusal)
    return event_of(claims)
