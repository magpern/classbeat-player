"""Data access of pairing a device (ADR 0002, section 6): calls of the `auth_*` functions.

The app's two calls (`start`, `collect`) run with no account set: all they touch is in the
closed table, behind the functions. The site's two calls (`find`, `decide`) take the
`AccountContext` of a signed-in request: the functions act for the account already set.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Literal

from player_backend.client_policy import ClientInfo
from player_backend.db.context import AccountContext
from player_backend.db.executor import DatabaseError, Pool
from player_backend.db.queries import pairing as q

_UNIQUE_VIOLATION = "23505"

# What `auth_decide_pairing` said: the pairing was approved or denied; no pending pairing has
# that code (a wrong code, which it counted) or the form is closed; or the approval was refused
# because the account is at its cap of devices.
type Decision = Literal["decided", "not_found", "device_limit"]


def start_allowed(pool: Pool, *, address_key: bytes, window: timedelta, max_starts: int) -> bool:
    """Count one pairing start for the address. False when it is over its limit."""
    with pool.handle() as db, db.transaction():
        over = db.rows(q.START_LIMIT_HIT, (address_key, window, max_starts))
        return over[0][0] is False


def start(
    pool: Pool, *, device_code_hash: bytes, user_code_hash: bytes, platform: str, version: str
) -> bool:
    """Write a pending pairing. False, with nothing written, when a code is still in use."""
    try:
        with pool.handle() as db, db.transaction():
            db.rows(q.START_PAIRING, (device_code_hash, user_code_hash, platform, version))
    except DatabaseError as error:
        if error.sqlstate != _UNIQUE_VIOLATION:
            raise
        return False
    return True


def collect(
    pool: Pool, *, device_code_hash: bytes, device_token_hash: bytes, client: ClientInfo
) -> tuple[object, object]:
    """One poll: (state, email). The email is set only with the state of success."""
    with pool.handle() as db, db.transaction():
        found = db.rows(
            q.COLLECT_PAIRING,
            (device_code_hash, device_token_hash, client.network, client.family),
        )
        state, email = found[0]
        return state, email


def find(ctx: AccountContext, user_code_hash: bytes) -> tuple[str, str] | None:
    """The platform and version of the pending pairing with this code, or None.

    None is also a wrong code that the function has counted: the caller's transaction must be
    committed for the count to stay.
    """
    found = ctx.db.rows(q.FIND_PAIRING, (user_code_hash,))
    if len(found) != 1:
        return None
    platform, version = found[0]
    if not (isinstance(platform, str) and isinstance(version, str)):
        return None
    return platform, version


def decide(
    ctx: AccountContext,
    *,
    user_code_hash: bytes,
    approve: bool,
    name: str | None,
    client: ClientInfo,
) -> Decision:
    """Approve or deny the pending pairing with this code: `decided` only when the function
    said so.

    `device_limit` is an approval above the cap of devices, which the function refused and
    wrote as the account's `pairing.refused` event. `not_found` is a wrong code (counted), a
    closed form and anything unexpected. For the count and the event to stay, the caller's
    transaction must be committed: a refusal is returned to the client, not raised.
    """
    done = ctx.db.rows(
        q.DECIDE_PAIRING, (user_code_hash, approve, name, client.network, client.family)
    )
    answer = done[0][0] if len(done) == 1 else False
    if answer is True:
        return "decided"
    return "device_limit" if answer is None else "not_found"
