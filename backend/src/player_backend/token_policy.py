"""Pure rules for long tokens (ADR 0002, sections 2 and 3): their shape and their hash.

A long token is `cbp_<type>_<secret>`, the secret 32 random bytes as base64url without padding
(43 characters). An endpoint accepts one type and refuses the rest by prefix, before any lookup
(principle 2). The server keeps and looks up only `SHA-256(token string)`.
"""

from __future__ import annotations

import hashlib
import re
from typing import Final, Literal

type TokenKind = Literal["lgn", "ml", "ses", "dc", "dev", "lc", "src", "hst", "ctl", "rdr"]

PREFIX: Final = "cbp"
SECRET_BYTES: Final = 32
_SECRET: Final = re.compile(r"[A-Za-z0-9_-]{43}")


def token_string(kind: TokenKind, secret_text: str) -> str:
    """The token of `kind` around an already encoded secret."""
    return "_".join((PREFIX, kind, secret_text))


def is_token(kind: TokenKind, value: object) -> bool:
    """Whether `value` is, exactly, a well-formed token of this one type."""
    if not isinstance(value, str):
        return False
    head = token_string(kind, "")
    return value.startswith(head) and _SECRET.fullmatch(value[len(head) :]) is not None


def token_hash(token: str) -> bytes:
    """What the server stores and looks a token up by: 32 bytes."""
    return hashlib.sha256(token.encode("utf-8")).digest()
