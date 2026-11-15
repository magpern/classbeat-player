"""Data access of sign-in with classbeat (ADR 0010, sections 2, 4 and 5): calls of the
`auth_*` functions.

No account is set here: these run before anyone is signed in, and everything they touch is in
the closed tables, behind the functions. Only hashes go in; nothing in clear is kept.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, cast

from player_backend.classbeat_flow_policy import Purpose
from player_backend.classbeat_policy import Identity
from player_backend.client_policy import ClientInfo
from player_backend.db.executor import DatabaseError, Pool
from player_backend.db.lock_wait import ran_out
from player_backend.db.queries import classbeat as q

type StartOutcome = Literal["started", "limited", "not_signed_in"]
type SignInOutcome = Literal["signed_in", "refused", "busy"]
type ReauthOutcome = Literal["reauthenticated", "refused", "busy"]


@dataclass(frozen=True)
class Flow:
    """A flow's row, used up by its callback."""

    purpose: Purpose
    return_to: str | None
    nonce_hash: bytes
    asking_session_hash: bytes | None
    started_at: datetime


def start(
    pool: Pool,
    *,
    binding_hash: bytes,
    state_hash: bytes,
    nonce_hash: bytes,
    purpose: Purpose,
    return_to: str | None,
    asking_session_hash: bytes | None,
    held_binding_hash: bytes | None,
    address_hash: bytes,
) -> StartOutcome:
    with pool.handle() as db, db.transaction():
        rows = db.rows(
            q.START_CLASSBEAT,
            (
                binding_hash,
                state_hash,
                nonce_hash,
                purpose,
                return_to,
                asking_session_hash,
                held_binding_hash,
                address_hash,
            ),
        )
    outcome = rows[0][0]
    if outcome in ("started", "limited", "not_signed_in"):
        return outcome
    raise ValueError("unexpected answer of auth_start_classbeat")


def take(pool: Pool, *, binding_hash: bytes, state_hash: bytes, address_hash: bytes) -> Flow | None:
    """Use the flow's row up. None: over the callback limit, no such row, or too old."""
    with pool.handle() as db, db.transaction():
        rows = db.rows(q.TAKE_CLASSBEAT, (binding_hash, state_hash, address_hash))
    if not rows:
        return None
    purpose, return_to, nonce_hash, asking, started_at = rows[0]
    if purpose not in ("sign_in", "reauth"):
        raise ValueError("unexpected purpose of a classbeat flow")
    return Flow(
        purpose=purpose,
        return_to=cast(str | None, return_to),
        nonce_hash=bytes(cast(bytes, nonce_hash)),
        asking_session_hash=None if asking is None else bytes(cast(bytes, asking)),
        started_at=cast(datetime, started_at),
    )


def _at(seconds: int) -> datetime:
    return datetime.fromtimestamp(seconds, UTC)


def complete(
    pool: Pool,
    *,
    identity: Identity,
    session_hash: bytes,
    address_hash: bytes,
    client: ClientInfo,
) -> SignInOutcome:
    """Sign in, or sign up where the allowlist allows it. The identity's email is the verified
    one, or None.

    `busy` when the wait for the account's sign-in lock ran out (#158): all is rolled back.
    """
    try:
        with pool.handle() as db, db.transaction():
            rows = db.rows(
                q.COMPLETE_CLASSBEAT,
                (
                    identity.issuer,
                    identity.subject,
                    identity.email,
                    identity.email is not None,
                    _at(identity.auth_time),
                    session_hash,
                    address_hash,
                    client.network,
                    client.family,
                ),
            )
    except DatabaseError as error:
        if not ran_out(error):
            raise
        return "busy"
    return "signed_in" if rows[0][0] == "signed_in" else "refused"


def reauthenticate(
    pool: Pool,
    *,
    asking_session_hash: bytes,
    identity: Identity,
    started_at: datetime,
    session_hash: bytes,
    client: ClientInfo,
) -> ReauthOutcome:
    """A fresh authentication of the asking session's own instructor: a new session."""
    try:
        with pool.handle() as db, db.transaction():
            rows = db.rows(
                q.REAUTH_CLASSBEAT,
                (
                    asking_session_hash,
                    identity.issuer,
                    identity.subject,
                    _at(identity.auth_time),
                    started_at,
                    session_hash,
                    client.network,
                    client.family,
                ),
            )
    except DatabaseError as error:
        if not ran_out(error):
            raise
        return "busy"
    return "reauthenticated" if rows[0][0] == "reauthenticated" else "refused"
