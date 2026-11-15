"""Data access of the operator's commands (ADR 0002, section 9), as player_owner only.

The commands connect with `PLAYER_DATABASE_OWNER_URL`, like the migration runner, and refuse
to go on when the connection is not `player_owner`: no running role's credential is used.
Everything goes through the schema's own rules: the allowlist's `player_owner` policy and the
`auth_purge_expired` function, and for `account link` the tenant policy with the one account
set for its transaction (also for `account delete`). Emails are checked and normalised by the
caller.

The check reads `current_user`, which a superuser's URL that sets `-c role=player_owner` also
passes. What the commands do is the same then (they act as `player_owner`); the README asks for
`player_owner`'s own login all the same.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from typing import Final
from uuid import UUID

from player_backend.db.executor import Handle, connect
from player_backend.db.queries import operator as q

OPERATOR_ROLE: Final = "player_owner"


class NotOperatorRole(RuntimeError):
    """The connection is not `player_owner`. Carries the role's name only, never the URL."""


@contextmanager
def operator_handle(url: str) -> Generator[Handle]:
    """A handle on a connection of its own, checked to act as player_owner."""
    with connect(url) as db:
        role = db.rows(q.CURRENT_ROLE)[0][0]
        if role != OPERATOR_ROLE:
            raise NotOperatorRole(f"the commands run as {OPERATOR_ROLE}, not as {role}")
        yield db


def allowlist_add(db: Handle, email: str) -> bool:
    """True when added, False when the email was listed already."""
    with db.transaction():
        return bool(db.rows(q.ALLOWLIST_ADD, (email,)))


def allowlist_remove(db: Handle, email: str) -> bool:
    """True when removed, False when the email was not listed."""
    with db.transaction():
        return bool(db.rows(q.ALLOWLIST_REMOVE, (email,)))


def allowlist_list(db: Handle) -> list[tuple[str, datetime]]:
    with db.transaction():
        rows = db.rows(q.ALLOWLIST_LIST)
    listed: list[tuple[str, datetime]] = []
    for email, added_at in rows:
        assert isinstance(email, str) and isinstance(added_at, datetime)
        listed.append((email, added_at))
    return listed


def purge_expired(db: Handle) -> None:
    """One call of `auth_purge_expired()`, in its own transaction. It returns nothing."""
    with db.transaction():
        db.rows(q.PURGE_EXPIRED)


def account_link(db: Handle, account_id: UUID, issuer: str, subject: str) -> bool:
    """ADR 0010, section 8: make an `unlinked` account the instructor of `(issuer, subject)`,
    once, and delete its passkeys. False when there is no unlinked account with that id."""
    with db.transaction():
        db.rows(q.SET_ACCOUNT, (str(account_id),))
        if not db.rows(q.LINK_ACCOUNT, (issuer, subject, account_id)):
            return False
        deleted = len(db.rows(q.DELETE_ACCOUNT_PASSKEYS, (account_id,)))
        db.rows(q.ACCOUNT_LINKED_EVENT, (account_id, deleted))
        return True


def account_delete(db: Handle, account_id: UUID) -> bool:
    """ADR 0010, section 8: delete the account, as ADR 0002, section 12 does: everything it owns
    goes by cascade, its events too, and its live sessions are told (`live_revocations`, sent
    at commit). False when there is no account with that id."""
    with db.transaction():
        db.rows(q.SET_ACCOUNT, (str(account_id),))
        if not db.rows(q.DELETE_ACCOUNT, (account_id,)):
            return False
        db.rows(q.NOTIFY_REVOKED, (account_id,))
        return True
