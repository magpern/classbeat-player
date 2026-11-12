"""Pure rules for short codes (ADR 0002, section 2): their shape and their hash.

A short code is 8 letters of a 20-letter alphabet without vowels or digits, shown as
`XXXX-XXXX`. Input ignores case, spaces and hyphens. The server keeps a code only as
`SHA-256(the 8 letters)`, like a long token.
"""

from __future__ import annotations

import hashlib
from typing import Final

ALPHABET: Final = "BCDFGHJKLMNPQRSTVWXZ"
LENGTH: Final = 8
# What a person may type: the code with spaces and hyphens, and room to spare.
INPUT_MAX: Final = 40


def normalise_code(raw: object) -> str | None:
    """The 8 letters of what was typed, or None when it is not a short code."""
    if not isinstance(raw, str) or len(raw) > INPUT_MAX:
        return None
    letters = raw.replace(" ", "").replace("-", "").upper()
    if len(letters) != LENGTH or any(letter not in ALPHABET for letter in letters):
        return None
    return letters


def show_code(code: str) -> str:
    """The code as a person reads it: `XXXX-XXXX`."""
    return code[:4] + "-" + code[4:]


def code_hash(code: str) -> bytes:
    """What the server stores and looks a short code up by: 32 bytes."""
    return hashlib.sha256(code.encode("ascii")).digest()
