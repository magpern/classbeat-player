"""Data access of the events classbeat sends (ADR 0010, section 8): calls of the `auth_*`
functions.

No account is set here: the route takes no credential, and what the event changes is done by
`auth_classbeat_event`, which finds the account by the identity it is given. Only the hash of
the `jti` is kept; the subject goes in to be matched and is written to no row or event.
"""

from __future__ import annotations

from typing import Literal

from player_backend.classbeat_event_policy import LIMIT_MAX, LIMIT_WINDOW, Event, jti_hash
from player_backend.db.executor import Pool
from player_backend.db.queries import classbeat_events as q

type Outcome = Literal["repeat", "no_account", "deleted", "revoked"]


def over_limit(pool: Pool, key: bytes) -> bool:
    """Count one event from an address. True when it is over 600 in the minute's window."""
    with pool.handle() as db, db.transaction():
        hit = db.rows(q.LIMIT_HIT, (key, LIMIT_WINDOW, LIMIT_MAX))
    return hit[0][0] is not False


def apply(pool: Pool, event: Event) -> Outcome:
    """Act on a checked event, once per `jti`, in a transaction of its own."""
    with pool.handle() as db, db.transaction():
        rows = db.rows(
            q.CLASSBEAT_EVENT, (jti_hash(event.jti), event.issuer, event.subject, event.kind)
        )
    outcome = rows[0][0]
    if outcome in ("repeat", "no_account", "deleted", "revoked"):
        return outcome
    raise ValueError("unexpected answer of auth_classbeat_event")
