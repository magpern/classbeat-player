"""Pure rules of class sync for the player API (ADR 0002, sections 6 and 7; plan, section 5).

- A cursor is a place in one account's own sync order: the `account_sync` position of that
  account. It starts at 0, before the account's first publication, and only grows. The changes
  "since a cursor" are the account's class rows whose place is above it, in that order.
- A cursor above the account's current one was never this account's: it came from another
  account, or from a server whose data was restored. The device is told to resync in full.
- A page holds at most `PAGE_MAX` changes, `PAGE_DEFAULT` when the device names no limit. The
  cursor of a page is the place of its last change, so the next page starts after it.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

PAGE_DEFAULT: Final = 100
PAGE_MAX: Final = 500
# The largest place a cursor can name: the column is a PostgreSQL bigint.
CURSOR_MAX: Final = 2**63 - 1


def page_request(after: str | None, limit: str | None) -> tuple[int, int] | None:
    """The cursor and page size of a request, from the query's raw text; None when either is
    not a plain decimal number in its range. Absent, they are 0 and `PAGE_DEFAULT`.

    Parsed here rather than by the framework, so the route refuses the request itself and the
    device token's use is still counted (ADR 0002, section 10).
    """
    cursor = 0 if after is None else _decimal(after)
    size = PAGE_DEFAULT if limit is None else _decimal(limit)
    if cursor is None or size is None or not is_page_request(cursor, size):
        return None
    return cursor, size


def _decimal(raw: str) -> int | None:
    # ASCII digits only (`int` would also take signs, spaces, `_` and other scripts' digits),
    # and no more than a bigint can have, so nothing large is ever converted.
    if _DECIMAL.fullmatch(raw) is None:
        return None
    return int(raw)


_DECIMAL: Final = re.compile(r"[0-9]{1,19}")


def is_page_request(after: int, limit: int) -> bool:
    """Whether a cursor and a page size are within their ranges."""
    return 0 <= after <= CURSOR_MAX and 1 <= limit <= PAGE_MAX


def needs_resync(after: int, current: int) -> bool:
    """Whether a cursor names a place this account's sync order has never reached."""
    return after > current


@dataclass(frozen=True)
class Page[T]:
    changes: Sequence[T]
    cursor: int
    more: bool


def page_of[T](found: Sequence[T], places: Sequence[int], after: int, limit: int) -> Page[T]:
    """One page from up to `limit + 1` changes in sync order, each with its place in `places`.

    The change past the limit is only the sign that more follow; it is not in the page.
    """
    if len(found) != len(places):
        raise ValueError("one place per change")
    if not is_page_request(after, limit):
        raise ValueError("cursor or limit out of range")
    kept = list(found[:limit])
    cursor = places[len(kept) - 1] if kept else after
    return Page(kept, cursor, len(found) > limit)
