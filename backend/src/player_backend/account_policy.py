"""Pure rules for the account's export and its deletion (ADR 0002, sections 10, 11 and 12).

- Export and deletion are sensitive actions: both need a recent sign-in (request_policy.py).
- Exports are counted per account, 3 a day, in a fixed window by `rate_limit_hit`. The
  number bounds a client, not the backend's role (which reads the same rows with its grants),
  so it is passed in like the source API's request limit (principle 7).
- Deleting the account also needs a typed confirmation: the account's email, as typed.
- What the export holds is chosen here, column by column: never a hash, a token, a key, the
  account's id or its passkey user handle.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Final
from uuid import UUID

# Section 10, "Account exports".
EXPORT_WINDOW: Final = timedelta(days=1)
EXPORT_MAX: Final = 3
# Section 11, "export made". Deleting the account writes no event: its events go with it.
EXPORTED: Final = "account.exported"
# The version of the export's own layout, so a later change can be told apart.
EXPORT_FORMAT: Final = 1
CONFIRM_MAX: Final = 254


def export_limit_key(account_id: UUID) -> bytes:
    """The counter of one account's exports: a hash, never the id itself."""
    return hashlib.sha256(b"account.exports:" + account_id.bytes).digest()


def confirmed(typed: str, email: str) -> bool:
    """True when the user typed the account's email (case and surrounding spaces aside)."""
    if len(typed) > CONFIRM_MAX:
        return False
    return typed.strip().lower() == email


def when(value: object) -> str | None:
    """A time as ISO 8601, or None."""
    return value.isoformat() if isinstance(value, datetime) else None


def text_or_none(value: object) -> str | None:
    return None if value is None else str(value)


def export_document(
    account: Mapping[str, object], parts: Mapping[str, list[dict[str, object]]], made_at: datetime
) -> dict[str, object]:
    """The export as one JSON object: its layout version, when it was made and every part."""
    return {
        "format": EXPORT_FORMAT,
        "exported_at": made_at.isoformat(),
        "account": account,
        **parts,
    }
