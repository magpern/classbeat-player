"""Pure rules of the class library as the site shows it (plan, section 5, "Class library";
ADR 0002, sections 7 and 12).

- The list holds every class row of the account that has a number above 0: the classes it
  holds and the markers of those removed. A marker has no title and no length.
- It is in the account's sync order, the latest change first. A page holds at most `PAGE_MAX`
  rows, `PAGE_DEFAULT` when the site names no limit. The cursor of a page is the place of its
  last row; the next page is asked for with `before=<cursor>`.
- The parameters arrive as raw text and are parsed here, so that the route refuses a malformed
  one itself and the session's use is kept (ADR 0002, section 10).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

PAGE_DEFAULT: Final = 50
PAGE_MAX: Final = 200
# The largest place a cursor can name: the column is a PostgreSQL bigint.
PLACE_MAX: Final = 2**63 - 1

_DECIMAL: Final = re.compile(r"[0-9]{1,19}")


@dataclass(frozen=True)
class PageRequest:
    """Rows strictly before the place `before` (None: from the latest), at most `limit`."""

    before: int | None
    limit: int


def page_request(before: str | None, limit: str | None) -> PageRequest | None:
    """The page a request names, from the query's raw text; None when either value is not a
    plain decimal number in its range."""
    place = None if before is None else _decimal(before)
    size = PAGE_DEFAULT if limit is None else _decimal(limit)
    if size is None or not 1 <= size <= PAGE_MAX:
        return None
    if before is not None and (place is None or place > PLACE_MAX):
        return None
    return PageRequest(place, size)


def _decimal(raw: str) -> int | None:
    # ASCII digits only (`int` would also take signs, spaces, `_` and other scripts' digits),
    # and no more than a bigint can have, so nothing large is ever converted.
    if _DECIMAL.fullmatch(raw) is None:
        return None
    return int(raw)


def title_of(removed: bool, value: object) -> str | None:
    """A class's title as the list shows it; None for a marker, which keeps no title."""
    if removed or not isinstance(value, str):
        return None
    return value


def length_of(removed: bool, value: object) -> int | None:
    """A class's length in milliseconds as the list shows it; None for a marker."""
    if removed or not isinstance(value, int) or isinstance(value, bool):
        return None
    return value
