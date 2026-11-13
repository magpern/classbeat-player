"""Pure rules for the size of a request's body (ADR 0002, section 10).

Every body the site and the app send is a small JSON object, so a body is held to 16 KiB
unless its route needs more. The one route that does is a source's publication: its route
reads the body itself, no further than its own limit of 2 MiB (publication_policy.py), and
answers an oversized one inside the source token's transaction, so it counts as the token's
use. An oversized body is refused before it has been read in full, and before any credential
is looked at or any transaction opened (body_cap.py).
"""

from __future__ import annotations

from typing import Final

BODY_MAX: Final = 16 * 1024

# The routes that read and limit their own body, by the path template of the route.
OWN_LIMIT: Final = frozenset({"/api/source/publications"})


def body_cap(route: str | None) -> int | None:
    """The largest body a request to the route with path template `route` may send, or None
    when that route sets its own. A request no route matches (`None`) gets the cap."""
    return None if route is not None and route in OWN_LIMIT else BODY_MAX


def declared_over(content_length: str | None, cap: int) -> bool:
    """Whether a `Content-Length` says the body is larger than `cap`.

    Only plain ASCII digits are a length here. Anything else is left to the server, which
    refuses a malformed length itself; the bytes are counted as they come either way.
    """
    if content_length is None or not content_length.isascii() or not content_length.isdigit():
        return False
    digits = content_length.lstrip("0")
    # Compared by length first: `int` refuses a string of thousands of digits.
    return len(digits) > len(str(cap)) or int(digits or "0") > cap
