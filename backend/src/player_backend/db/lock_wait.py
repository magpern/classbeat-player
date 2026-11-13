"""A bounded wait for a lock that ran out (#158, ADR 0002, section 10).

The account's sign-in lock and its passkey-additions lock are waited for under a
`lock_timeout`. When it runs out, PostgreSQL fails the statement with `lock_not_available`; the
caller's transaction (or savepoint) is rolled back, so nothing it wrote is kept, and the request
is answered 429 with `Retry-After` instead of an error.
"""

from __future__ import annotations

from typing import Final

from player_backend.db.executor import DatabaseError

# PostgreSQL's code for a lock wait that ran out under `lock_timeout`.
LOCK_NOT_AVAILABLE: Final = "55P03"


def ran_out(error: DatabaseError) -> bool:
    """Whether `error` is a lock wait that ran out, not any other failure."""
    return error.sqlstate == LOCK_NOT_AVAILABLE
