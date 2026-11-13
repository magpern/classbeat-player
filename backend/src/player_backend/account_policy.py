"""Pure rules for the account's export and its deletion (ADR 0002, sections 10, 11 and 12).

- Export and deletion are sensitive actions: both need a recent sign-in (request_policy.py).
- Exports are counted per account, 3 a day, in a fixed window by `rate_limit_hit`. The
  number bounds a client, not the backend's role (which reads the same rows with its grants),
  so it is passed in like the source API's request limit (principle 7).
- Deleting the account also needs a typed confirmation: the account's email, as typed.
- What the export holds is chosen here, column by column: never a hash, a token, a key, the
  account's id or its passkey user handle.
- The export is streamed (section 12): one JSON document written piece by piece, the small
  parts first and then the classes, read in pages of at most 16. A document is at most 1 MiB,
  so about 16 MiB of classes is held at a time.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Iterator, Mapping
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
# Classes read and held at a time while the export is streamed.
EXPORT_PAGE: Final = 16


class ExportStopped(Exception):
    """The stream ends here, unclosed: the session ended or the account went mid-export."""


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


def export_head(
    account: Mapping[str, object], parts: Mapping[str, list[dict[str, object]]], made_at: datetime
) -> dict[str, object]:
    """Everything of the export but its classes: its layout version, when it was made, the
    account and the small parts."""
    return {
        "format": EXPORT_FORMAT,
        "exported_at": made_at.isoformat(),
        "account": account,
        **parts,
    }


def class_entry(row: tuple[object, ...]) -> dict[str, object]:
    """One class of the export, from (source, source class id, number, kind, published at,
    document)."""
    source, class_id, number, kind, published, document = row
    return {
        "source": source,
        "source_class_id": class_id,
        "publication_number": number,
        "removed": kind == "removal",
        "published_at": when(published),
        "document": document,
    }


def _dumped(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def export_chunks(
    head: Mapping[str, object], classes: Iterable[Mapping[str, object]]
) -> Iterator[bytes]:
    """The export as one JSON object, written piece by piece: the head, then `"classes"`, one
    class at a time, then the close. When `classes` raises, nothing more is written, so the
    text that was sent is not valid JSON and cannot be taken for a whole export."""
    opening = _dumped(dict(head))
    yield (opening[:-1] + ',"classes":[').encode()
    separator = ""
    for entry in classes:
        yield (separator + _dumped(entry)).encode()
        separator = ","
    yield b"]}"
