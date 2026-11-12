"""Making a new long token from the operating system's random source (ADR 0002, section 2)."""

from __future__ import annotations

import base64
import secrets

from player_backend.token_policy import SECRET_BYTES, TokenKind, token_string


def new_token(kind: TokenKind) -> str:
    """A new token of `kind`: 256 random bits. The clear value is shown or sent once."""
    secret = base64.urlsafe_b64encode(secrets.token_bytes(SECRET_BYTES)).rstrip(b"=")
    return token_string(kind, secret.decode("ascii"))
