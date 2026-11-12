"""Data access of site sessions (ADR 0002, sections 5, 9 and 11).

`entered` is the request's transaction: `auth_enter_session` is its first statement. Everything
else takes the `AccountContext` it yields and filters by its account in the code.
"""

from __future__ import annotations

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import cast
from uuid import UUID

from player_backend.client_policy import ClientInfo
from player_backend.db.context import AccountContext
from player_backend.db.executor import Pool
from player_backend.db.queries import site_sessions as q

# Section 11: "signed out" (one session, this one or another of the account) and "all sessions
# ended".
SIGNED_OUT = "session.signed_out"
ALL_ENDED = "session.all_ended"


@dataclass(frozen=True)
class SessionInfo:
    id: UUID
    family: str
    created_at: datetime
    last_used_at: datetime


@contextmanager
def entered(pool: Pool, token_hash: bytes) -> Generator[AccountContext | None]:
    """The transaction of a signed-in request, or None when the token is no live session.

    Committed when the block ends, rolled back when it raises.
    """
    with pool.handle() as db, db.transaction():
        found = db.rows(q.ENTER_SESSION, (token_hash,))
        current = db.rows(q.CURRENT_ACCOUNT)
        if len(found) != 1:
            yield None
            return
        session_id, signed_in_at = found[0]
        account_id, now = current[0]
        if not (
            isinstance(session_id, UUID)
            and isinstance(signed_in_at, datetime)
            and isinstance(account_id, UUID)
            and isinstance(now, datetime)
        ):
            yield None
            return
        yield AccountContext(
            account_id=account_id,
            credential_kind="session",
            credential_id=session_id,
            signed_in_at=signed_in_at,
            entered_at=now,
            db=db,
        )


def _event(ctx: AccountContext, event: str, client: ClientInfo, detail: dict[str, object]) -> None:
    ctx.db.rows(
        q.ADD_SESSION_EVENT,
        (
            ctx.account_id,
            event,
            ctx.credential_id,
            client.network,
            client.family,
            json.dumps(detail),
        ),
    )


def list_sessions(ctx: AccountContext) -> list[SessionInfo]:
    """The account's live sessions, the most recently used first."""
    found: list[SessionInfo] = []
    for session_id, family, created_at, last_used_at in ctx.db.rows(
        q.LIST_SESSIONS, (ctx.account_id,)
    ):
        found.append(
            SessionInfo(
                cast(UUID, session_id),
                cast(str, family),
                cast(datetime, created_at),
                cast(datetime, last_used_at),
            )
        )
    return found


def end_session(ctx: AccountContext, session_id: UUID, client: ClientInfo) -> bool:
    """End one session of the account. False when the account has no such session."""
    if not ctx.db.rows(q.END_SESSION, (ctx.account_id, session_id)):
        return False
    _event(ctx, SIGNED_OUT, client, {"current": session_id == ctx.credential_id})
    return True


def end_all_sessions(ctx: AccountContext, client: ClientInfo) -> int:
    """End every session of the account, this one included. Returns how many."""
    ended = len(ctx.db.rows(q.END_ALL_SESSIONS, (ctx.account_id,)))
    _event(ctx, ALL_ENDED, client, {"sessions": ended})
    return ended
