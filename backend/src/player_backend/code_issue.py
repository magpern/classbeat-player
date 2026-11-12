"""Making a new short code from the operating system's random source (ADR 0002, section 2)."""

from __future__ import annotations

import secrets

from player_backend.code_policy import ALPHABET, LENGTH


def new_code() -> str:
    """A new short code: 8 letters, each drawn evenly from the 20. Shown once."""
    return "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
