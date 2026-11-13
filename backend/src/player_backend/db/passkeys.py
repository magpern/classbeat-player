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
from player_backend.db.executor import Row
from player_backend.db.queries import passkeys as q
from player_backend.passkey_policy import PASSKEYS_MAX, NewPasskey

# Section 11: passkey added or removed.
ADDED = "passkey.added"
REMOVED = "passkey.removed"

type AddOutcome = Literal["refused", "too_many", "exists"]


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


def list_passkeys(ctx: AccountContext) -> list[PasskeyInfo]:
    """The account's passkeys, the oldest first."""
    return [_info(row) for row in ctx.db.rows(q.LIST_PASSKEYS, (ctx.account_id,))]


def start_registration(ctx: AccountContext, challenge_hash: bytes) -> RegistrationUser | None:
    """Store a registration challenge for this session, replacing its older one.

    None when the account holds its 10 passkeys already: nothing is stored then.
    """
    count = ctx.db.rows(q.COUNT_PASSKEYS, (ctx.account_id,))[0][0]
    if not isinstance(count, int) or count >= PASSKEYS_MAX:
        return None
    user = ctx.db.rows(q.ACCOUNT_USER, (ctx.account_id,))
    if len(user) != 1:
        return None
    email, user_handle = user[0]
    existing = [cast(bytes, row[0]) for row in ctx.db.rows(q.CREDENTIAL_IDS, (ctx.account_id,))]
    ctx.db.rows(q.DROP_REGISTRATIONS, (ctx.account_id, ctx.credential_id))
    ctx.db.rows(q.NEW_REGISTRATION, (ctx.account_id, ctx.credential_id, challenge_hash))
    return RegistrationUser(cast(str, email), cast(bytes, user_handle), existing)


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
    credential id already.
    """
    if challenge_hash is None:
        return "refused"
    used = ctx.db.rows(q.USE_REGISTRATION, (ctx.account_id, ctx.credential_id, challenge_hash))
    if not used:
        return "refused"
    new = verify()
    if new is None:
        return "refused"
    ctx.db.rows(q.LOCK_ADDITIONS, (ctx.account_id,))
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
