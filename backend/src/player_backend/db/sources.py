"""Data access of source links and the source token (ADR 0002, sections 7, 9, 10 and 11).

`entered` is the request's transaction for a source token: `auth_enter_source` is its first
statement. The site's calls take the `AccountContext` of a signed-in request; the code exchange
runs with no account set: what it reads is in the closed table, behind the function.
"""

from __future__ import annotations

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, cast
from uuid import UUID

from player_backend.bearer_policy import (
    SAME_TOKEN_MAX,
    SAME_TOKEN_WINDOW,
    UNKNOWN_MAX,
    UNKNOWN_WINDOW,
)
from player_backend.client_policy import ClientInfo
from player_backend.db.context import AccountContext
from player_backend.db.devices import BearerKeys
from player_backend.db.executor import Handle, Pool
from player_backend.db.queries import sources as q
from player_backend.source_policy import REQUEST_MAX, REQUEST_WINDOW

# Section 11. "Source linked" is written inside auth_exchange_link_code.
REVOKED = "source.revoked"


@dataclass(frozen=True)
class Refused:
    """A source token that sets no account, and what its counters said."""

    state: Literal["unknown", "limited"]
    same_token_over: bool = False
    unknown_over: bool = False


@dataclass(frozen=True)
class SourceKeys(BearerKeys):
    """The keys of one request's counters, and that of the source token's own requests."""

    requests: bytes


@dataclass(frozen=True)
class SourceEntry:
    """A source-token request: its account context and the source the token is for."""

    context: AccountContext
    source_id: str


@dataclass(frozen=True)
class LinkInfo:
    id: UUID
    source_id: str
    linked_at: datetime
    last_used_at: datetime | None


def _over(db: Handle, key: bytes, window: timedelta, limit: int) -> bool:
    return db.rows(q.LIMIT_HIT, (key, window, limit))[0][0] is not False


def _enter(db: Handle, token_hash: bytes) -> SourceEntry | None:
    found = db.rows(q.ENTER_SOURCE, (token_hash,))
    current = db.rows(q.CURRENT_ACCOUNT)
    if len(found) != 1:
        return None
    link_id, source_id = found[0]
    account_id, now = current[0]
    if not (
        isinstance(link_id, UUID)
        and isinstance(source_id, str)
        and isinstance(account_id, UUID)
        and isinstance(now, datetime)
    ):
        return None
    context = AccountContext(
        account_id=account_id,
        credential_kind="source",
        credential_id=link_id,
        signed_in_at=None,
        entered_at=now,
        db=db,
    )
    return SourceEntry(context, source_id)


@contextmanager
def entered(pool: Pool, token_hash: bytes, keys: SourceKeys) -> Generator[SourceEntry | Refused]:
    """The transaction of a source-token request, or why the token sets no account.

    Committed when the block ends, rolled back when it raises. For a `Refused` the caller
    leaves the block first and raises after it, so that what was counted stays counted.
    """
    with pool.handle() as db, db.transaction():
        entry = _enter(db, token_hash)
        if entry is not None:
            if _over(db, keys.requests, REQUEST_WINDOW, REQUEST_MAX):
                yield Refused("limited")
            else:
                yield entry
            return
        # The address's counter first (section 10). An address over its limit of unknown tokens
        # is refused by that alone, and gets no counter row for each further token it makes up.
        unknown_over = _over(db, keys.unknown_tokens, UNKNOWN_WINDOW, UNKNOWN_MAX)
        same_token_over = not unknown_over and _over(
            db, keys.same_token, SAME_TOKEN_WINDOW, SAME_TOKEN_MAX
        )
        yield Refused("unknown", same_token_over=same_token_over, unknown_over=unknown_over)


@contextmanager
def entered_again(pool: Pool, token_hash: bytes) -> Generator[SourceEntry | None]:
    """A second transaction of the same request (section 7, a refused publication): the account
    is entered again with `auth_enter_source`, and nothing is counted. None when the token no
    longer sets an account (the link was revoked meanwhile)."""
    with pool.handle() as db, db.transaction():
        yield _enter(db, token_hash)


def exchange_allowed(pool: Pool, *, address_key: bytes, window: timedelta, max_hits: int) -> bool:
    """Count one code exchange for the address. False when it is over its limit."""
    with pool.handle() as db, db.transaction():
        return not _over(db, address_key, window, max_hits)


def exchange(
    pool: Pool,
    *,
    code_hash: bytes,
    source_id: str,
    redirect_uri: str,
    verifier: str,
    token_hash: bytes,
    client: ClientInfo,
) -> bool:
    """Exchange a link code for the source token whose hash is given. True when linked.

    Committed either way: a code that was found is used up, and its event stays.
    """
    with pool.handle() as db, db.transaction():
        done = db.rows(
            q.EXCHANGE_LINK_CODE,
            (
                code_hash,
                source_id,
                redirect_uri,
                verifier,
                token_hash,
                client.network,
                client.family,
            ),
        )
        return done[0][0] is True


def new_link_code(
    ctx: AccountContext, *, code_hash: bytes, source_id: str, redirect_uri: str, challenge: str
) -> None:
    """Store the code of a link the signed-in user approved, for the account already set."""
    ctx.db.rows(q.NEW_LINK_CODE, (code_hash, source_id, redirect_uri, challenge))


def account_email(ctx: AccountContext) -> str | None:
    found = ctx.db.rows(q.ACCOUNT_EMAIL, (ctx.account_id,))
    email = found[0][0] if len(found) == 1 else None
    return email if isinstance(email, str) else None


def list_links(ctx: AccountContext) -> list[LinkInfo]:
    """The account's links that are not ended, the most recently linked first."""
    return [
        LinkInfo(
            cast(UUID, link_id),
            cast(str, source_id),
            cast(datetime, created_at),
            cast("datetime | None", last_used_at),
        )
        for link_id, source_id, created_at, last_used_at in ctx.db.rows(
            q.LIST_LINKS, (ctx.account_id,)
        )
    ]


def revoke(ctx: AccountContext, link_id: UUID, client: ClientInfo) -> bool:
    """End one link of the account: its token stops working. False when there is no such link.

    The classes stay: they belong to the account (section 7).
    """
    found = ctx.db.rows(q.REVOKE_LINK, (ctx.account_id, link_id))
    if not found:
        return False
    by = "source" if ctx.credential_kind == "source" else "user"
    detail: dict[str, object] = {"source": str(found[0][0]), "by": by}
    add_event(ctx, REVOKED, client, detail)
    return True


def add_event(
    ctx: AccountContext, event: str, client: ClientInfo, detail: dict[str, object]
) -> None:
    """One audit event of the account, with the request's credential as the one that acted."""
    ctx.db.rows(
        q.ADD_SOURCE_EVENT,
        (
            ctx.account_id,
            event,
            ctx.credential_kind,
            ctx.credential_id,
            client.network,
            client.family,
            json.dumps(detail),
        ),
    )
