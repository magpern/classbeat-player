"""Data access of an account's passkeys on the site (ADR 0002, sections 4, 9 and 11).

Everything takes the `AccountContext` of a signed-in request and filters by its account in the
code. Adding and removing write their events here, with the backend's own grants (section 9:
such an event is the backend's, not a function's). The public key never leaves the database
through these functions but into a new row.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from player_backend.client_policy import ClientInfo
from player_backend.db.context import AccountContext
from player_backend.db.executor import DatabaseError, Row
from player_backend.db.lock_wait import ran_out
from player_backend.db.queries import passkeys as q
from player_backend.passkey_policy import (
    ADDITIONS_LOCK_WAIT,
    PASSKEYS_MAX,
    STARTS_MAX,
    STARTS_WINDOW,
    NewPasskey,
    registration_starts_key,
)

# Section 11: passkey added or removed.
ADDED = "passkey.added"
REMOVED = "passkey.removed"

type AddOutcome = Literal["refused", "too_many", "exists", "busy"]
type StartRefusal = Literal["limited", "too_many"]


@dataclass(frozen=True)
class PasskeyInfo:
    id: UUID
    name: str
    created_at: datetime
    last_used_at: datetime | None


@dataclass(frozen=True)
class RegistrationUser:
    """What the registration options name: the account's email and passkey user handle, and
    the credential ids it holds already."""

    email: str
    user_handle: bytes
    existing: list[bytes]


def _info(row: Row) -> PasskeyInfo:
    passkey_id, name, created_at, last_used_at = row
    return PasskeyInfo(
        cast(UUID, passkey_id),
        cast(str, name),
        cast(datetime, created_at),
        cast(datetime | None, last_used_at),
    )


def _event(ctx: AccountContext, event: str, client: ClientInfo, passkey_id: UUID) -> None:
    detail = json.dumps({"passkey_id": str(passkey_id)})
    ctx.db.rows(
        q.ADD_PASSKEY_EVENT,
        (ctx.account_id, event, ctx.credential_id, client.network, client.family, detail),
    )


def lock_additions(ctx: AccountContext) -> bool:
    """Take the account's additions lock, waiting at most `ADDITIONS_LOCK_WAIT`. False when the
    wait ran out: its savepoint is rolled back and the transaction can go on."""
    try:
        with ctx.db.transaction():
            prior = ctx.db.rows(q.LOCK_WAIT_NOW)[0][0]
            ctx.db.rows(q.SET_LOCK_WAIT, (ADDITIONS_LOCK_WAIT,))
            ctx.db.rows(q.LOCK_ADDITIONS, (ctx.account_id,))
            ctx.db.rows(q.SET_LOCK_WAIT, (prior,))
    except DatabaseError as error:
        if not ran_out(error):
            raise
        return False
    return True


def list_passkeys(ctx: AccountContext) -> list[PasskeyInfo]:
    """The account's passkeys, the oldest first."""
    return [_info(row) for row in ctx.db.rows(q.LIST_PASSKEYS, (ctx.account_id,))]


def start_registration(
    ctx: AccountContext, challenge_hash: bytes
) -> RegistrationUser | StartRefusal:
    """Count one registration start for the account, then store a registration challenge for
    this session, replacing its older one.

    Nothing but the count is stored when the account is over its limit of starts (`limited`,
    section 10) or holds its 10 passkeys already (`too_many`). The caller returns these
    refusals rather than raising them: raising would roll the count back.
    """
    limited = ctx.db.rows(
        q.STARTS_LIMIT_HIT, (registration_starts_key(ctx.account_id), STARTS_WINDOW, STARTS_MAX)
    )
    if limited[0][0] is not False:
        return "limited"
    count = ctx.db.rows(q.COUNT_PASSKEYS, (ctx.account_id,))[0][0]
    if not isinstance(count, int) or count >= PASSKEYS_MAX:
        return "too_many"
    user = ctx.db.rows(q.ACCOUNT_USER, (ctx.account_id,))
    if len(user) != 1:
        return "too_many"
    email, user_handle = user[0]
    existing = [cast(bytes, row[0]) for row in ctx.db.rows(q.CREDENTIAL_IDS, (ctx.account_id,))]
    ctx.db.rows(q.DROP_REGISTRATIONS, (ctx.account_id, ctx.credential_id))
    ctx.db.rows(q.NEW_REGISTRATION, (ctx.account_id, ctx.credential_id, challenge_hash))
    return RegistrationUser(cast(str, email), cast(bytes, user_handle), existing)


def account_email(ctx: AccountContext) -> str | None:
    """The account's email, for the notice of a new passkey."""
    found = ctx.db.rows(q.ACCOUNT_USER, (ctx.account_id,))
    email = found[0][0] if len(found) == 1 else None
    return email if isinstance(email, str) else None


def finish_registration(
    ctx: AccountContext,
    *,
    challenge_hash: bytes | None,
    name: str,
    verify: Callable[[], NewPasskey | None],
    client: ClientInfo,
) -> PasskeyInfo | AddOutcome:
    """Use up this session's registration challenge, then add the passkey `verify` gives.

    The challenge is used up whatever follows, so the caller returns a refusal rather than
    raising it: raising would roll the use back. `exists` when any account holds the
    credential id already. `busy` when the wait for the account's additions lock ran out
    (#158): nothing is added, and the caller raises it, so that the use is rolled back too and
    the same answer can be sent again.
    """
    if challenge_hash is None:
        return "refused"
    used = ctx.db.rows(q.USE_REGISTRATION, (ctx.account_id, ctx.credential_id, challenge_hash))
    if not used:
        return "refused"
    new = verify()
    if new is None:
        return "refused"
    if not lock_additions(ctx):
        return "busy"
    count = ctx.db.rows(q.COUNT_PASSKEYS, (ctx.account_id,))[0][0]
    if not isinstance(count, int) or count >= PASSKEYS_MAX:
        return "too_many"
    added = ctx.db.rows(
        q.ADD_PASSKEY,
        (
            ctx.account_id,
            new.credential_id,
            new.public_key,
            new.sign_count,
            list(new.transports),
            name,
        ),
    )
    if len(added) != 1:
        return "exists"
    found = _info(added[0])
    _event(ctx, ADDED, client, found.id)
    return found


def rename(ctx: AccountContext, passkey_id: UUID, name: str) -> PasskeyInfo | None:
    """Give one of the account's passkeys a new name. None when it has no such passkey."""
    renamed = ctx.db.rows(q.RENAME_PASSKEY, (ctx.account_id, passkey_id, name))
    return _info(renamed[0]) if len(renamed) == 1 else None


def remove(ctx: AccountContext, passkey_id: UUID, client: ClientInfo) -> bool:
    """Remove one of the account's passkeys. False when it has no such passkey."""
    if not ctx.db.rows(q.REMOVE_PASSKEY, (ctx.account_id, passkey_id)):
        return False
    _event(ctx, REMOVED, client, passkey_id)
    return True
