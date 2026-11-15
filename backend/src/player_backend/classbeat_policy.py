"""Pure rules for classbeat's ID tokens (ADR 0010, section 3). No I/O.

Every number and name here is a constant, changed only in a security-critical pull request
(ADR 0002, principle 7, as ADR 0010 amends it). The checks are split by what they read: the
header, the key the header names, then the claims. Each answers the reason of its refusal, or
None; a reason is a fixed word for the tests and never holds a value of the token.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

# The one algorithm, never taken from the token.
ALGORITHM: Final = "ES256"
JWT_TYPE: Final = "JWT"
KEY_TYPE: Final = "EC"
CURVE: Final = "P-256"
KEY_USE: Final = "sig"
# Allowed clock difference, and how old `iat` may be.
CLOCK_SKEW: Final = 60
ISSUED_WITHIN: Final = 5 * 60
SUBJECT_MAX: Final = 255
EMAIL_MAX: Final = 254

type Json = Mapping[str, object]


@dataclass(frozen=True)
class Identity:
    """What a checked ID token says. `email` is kept only when classbeat verified it."""

    issuer: str
    subject: str
    email: str | None
    auth_time: int


def nonce_hash(nonce: str) -> bytes:
    """What the sign-in row keeps of the nonce: its SHA-256."""
    return hashlib.sha256(nonce.encode("utf-8")).digest()


def header_refusal(header: Json) -> str | None:
    """The header first: `alg` exactly ES256, `typ` JWT when present, a `kid`."""
    if header.get("alg") != ALGORITHM:
        return "alg"
    if "typ" in header and header.get("typ") != JWT_TYPE:
        return "typ"
    if "crit" in header:
        return "crit"
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        return "kid"
    return None


def key_refusal(key: Json) -> str | None:
    """A key of the set may check an ID token only as an ES256 signing key on P-256."""
    if key.get("kty") != KEY_TYPE or key.get("crv") != CURVE:
        return "kty"
    if "use" in key and key.get("use") != KEY_USE:
        return "use"
    if "alg" in key and key.get("alg") != ALGORITHM:
        return "alg"
    if not isinstance(key.get("x"), str) or not isinstance(key.get("y"), str):
        return "key"
    return None


def select_key(keys: Sequence[Json], kid: str) -> Json | None:
    """The one key named `kid`, when it is exactly one and a usable key; else None."""
    named = [key for key in keys if key.get("kid") == kid]
    if len(named) != 1 or key_refusal(named[0]) is not None:
        return None
    return named[0]


def _number(value: object) -> int | None:
    # A NumericDate: a finite number (a JSON bool is not one).
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return int(value)


def _audience_refusal(claims: Json, client_id: str) -> str | None:
    audience = claims.get("aud")
    if isinstance(audience, list):
        held: list[object] = list(audience)  # pyright: ignore[reportUnknownArgumentType]
        if held != [client_id]:
            return "aud"
    elif audience != client_id:
        return "aud"
    if "azp" in claims and claims.get("azp") != client_id:
        return "azp"
    return None


def _time_refusal(claims: Json, now: int) -> str | None:
    expires = _number(claims.get("exp"))
    if expires is None or expires + CLOCK_SKEW <= now:
        return "exp"
    issued = _number(claims.get("iat"))
    if issued is None or issued < now - ISSUED_WITHIN - CLOCK_SKEW or issued > now + CLOCK_SKEW:
        return "iat"
    auth_time = _number(claims.get("auth_time"))
    if auth_time is None or auth_time > now + CLOCK_SKEW:
        return "auth_time"
    return None


def claims_refusal(
    claims: Json, *, issuer: str, client_id: str, expected_nonce_hash: bytes, now: int
) -> str | None:
    """`iss` exact, `aud` and `azp` the client, the times, the nonce and the subject."""
    if claims.get("iss") != issuer:
        return "iss"
    refusal = _audience_refusal(claims, client_id) or _time_refusal(claims, now)
    if refusal is not None:
        return refusal
    nonce = claims.get("nonce")
    if not isinstance(nonce, str) or nonce_hash(nonce) != expected_nonce_hash:
        return "nonce"
    subject = claims.get("sub")
    if not isinstance(subject, str) or not 1 <= len(subject) <= SUBJECT_MAX:
        return "sub"
    return None


def verified_email(claims: Json) -> str | None:
    """The email, trimmed and lower-cased, only when `email_verified` is exactly true."""
    email = claims.get("email")
    if claims.get("email_verified") is not True or not isinstance(email, str):
        return None
    email = email.strip().lower()
    local, at, domain = email.rpartition("@")
    plain = email.isprintable() and not any(c.isspace() for c in email)
    if not (at and local and domain and plain and 3 <= len(email) <= EMAIL_MAX):
        return None
    return email


def identity_of(claims: Json) -> Identity:
    """The identity of claims that passed `claims_refusal`."""
    auth_time = _number(claims.get("auth_time"))
    issuer, subject = claims.get("iss"), claims.get("sub")
    if not isinstance(issuer, str) or not isinstance(subject, str) or auth_time is None:
        raise ValueError("claims not checked")
    return Identity(issuer, subject, verified_email(claims), auth_time)
