"""Pure rules for what may reach a log line (ADR 0002, principle 4 and section 11).

No token, code or hash is ever logged. Callers do not log them in the first place; this is the
backstop that removes anything that still looks like one.
"""

from __future__ import annotations

import re

REDACTED = "[redacted]"

# Long tokens (ADR 0002, section 2): cbp_<type>_<43 base64url characters>.
_TOKEN = re.compile(r"cbp_[a-z]{2,3}_[A-Za-z0-9_-]{43}")
# A SHA-256 written as hex (64 characters), with or without a "\x" bytea prefix.
_HEX_HASH = re.compile(r"(?:\\x)?(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])")
# Short codes: 8 letters of the code alphabet, with or without the hyphen.
_SHORT_CODE = re.compile(r"\b[BCDFGHJKLMNPQRSTVWXZ]{4}-?[BCDFGHJKLMNPQRSTVWXZ]{4}\b")
# Header values that carry credentials, if one is ever formatted into a message.
_CREDENTIAL_HEADER = re.compile(r"(?i)\b(authorization|cookie|set-cookie)\s*[:=]\s*\S.*")


def redact(text: str) -> str:
    """Return `text` with every token, hash, short code and credential header value removed."""
    text = _CREDENTIAL_HEADER.sub(lambda m: f"{m.group(1)}: {REDACTED}", text)
    text = _TOKEN.sub(REDACTED, text)
    text = _HEX_HASH.sub(REDACTED, text)
    return _SHORT_CODE.sub(REDACTED, text)
