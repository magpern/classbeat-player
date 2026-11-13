"""Data access of the account's email, its export and its deletion (ADR 0002, sections 9, 11
and 12).

Every read filters by the account in the code; the policy is the backstop.

- `own_email` reads the account's own email for `GET /api/site/me`, in the request's
  transaction. `_email_and_created_at` reads the email with the account's creation time, for the
  export's head and for the deletion's confirmation.
- `export_head` runs in the signed-in request's transaction: it writes the "export made" event
  and reads the account's small parts, column by column.
- `class_pages` reads the classes after that transaction has committed, while the answer is
  streamed: one page of at most 16 at a time, each page in a short transaction of its own that
  enters the session again first. When the session has ended or the account is gone, the
  stream stops. No connection is held between pages, and nothing is stored.
- `delete` deletes the account row. Everything the account owns goes with it by cascade, in the
  same transaction: classes and their markers, the sync cursor, devices, source links,
  sessions, passkeys, approved pairings, link codes and audit events. The cascade runs as the
  tables' owner, so row-level security does not stop it and `player_app` needs no `DELETE` on
  those tables. Every token of the account is refused from the next request on: its row is gone.
  The same transaction sends the account's `live_revocations` notice (`revocation.notify`), so
  the live process ends the account's live sessions at once.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Literal
from uuid import UUID

from player_backend import account_policy
from player_backend.account_policy import (
    EXPORT_MAX,
    EXPORT_PAGE,
    EXPORT_WINDOW,
    EXPORTED,
    ExportStopped,
    class_entry,
    confirmed,
    export_limit_key,
    text_or_none,
    when,
)
from player_backend.client_policy import ClientInfo
from player_backend.db import revocation, site_sessions
from player_backend.db.context import AccountContext
from player_backend.db.executor import Pool
from player_backend.db.queries import account as q


def over_export_limit(ctx: AccountContext) -> bool:
    """Count one export of the account. True when it is over 3 in the day's window."""
    hit = ctx.db.rows(q.LIMIT_HIT, (export_limit_key(ctx.account_id), EXPORT_WINDOW, EXPORT_MAX))
    return hit[0][0] is not False


def _email_and_created_at(ctx: AccountContext) -> tuple[str, object] | None:
    """(email, created_at) of the account, or None when the account is gone."""
    found = ctx.db.rows(q.EMAIL_AND_CREATED_AT, (ctx.account_id,))
    if len(found) != 1 or not isinstance(found[0][0], str):
        return None
    return found[0][0], found[0][1]


def own_email(ctx: AccountContext) -> str | None:
    """The account's own email, as stored, or None when the account is gone."""
    found = ctx.db.rows(q.OWN_EMAIL, (ctx.account_id,))
    if len(found) != 1 or not isinstance(found[0][0], str):
        return None
    return found[0][0]


def export_head(ctx: AccountContext, client: ClientInfo) -> dict[str, object] | None:
    """The export without its classes, or None when the account is gone."""
    found = _email_and_created_at(ctx)
    if found is None:
        return None
    email, created_at = found
    # Written first, so the export holds the event of its own making.
    ctx.db.rows(
        q.ADD_EVENT, (ctx.account_id, EXPORTED, ctx.credential_id, client.network, client.family)
    )
    key = (ctx.account_id,)
    parts: dict[str, list[dict[str, object]]] = {
        "devices": [
            {
                "id": str(device_id),
                "name": name,
                "platform": platform,
                "version": version,
                "paired_at": when(created),
                "last_used_at": when(used),
                "revoked_at": when(revoked),
            }
            for device_id, name, platform, version, created, used, revoked in ctx.db.rows(
                q.DEVICES, key
            )
        ],
        "source_links": [
            {
                "id": str(link_id),
                "source": source,
                "linked_at": when(created),
                "last_used_at": when(used),
            }
            for link_id, source, created, used in ctx.db.rows(q.SOURCE_LINKS, key)
        ],
        "passkeys": [
            {"name": name, "created_at": when(created), "last_used_at": when(used)}
            for name, created, used in ctx.db.rows(q.PASSKEYS, key)
        ],
        "sessions": [
            {
                "id": str(session_id),
                "browser": family,
                "signed_in_at": when(signed),
                "created_at": when(created),
                "last_used_at": when(used),
                "current": session_id == ctx.credential_id,
            }
            for session_id, family, signed, created, used in ctx.db.rows(q.SESSIONS, key)
        ],
        "audit_events": [
            {
                "occurred_at": when(occurred),
                "event": event,
                "credential_kind": kind,
                "credential_id": text_or_none(credential),
                "client_network": network,
                "client_family": family,
                "detail": detail,
            }
            for occurred, event, kind, credential, network, family, detail in ctx.db.rows(
                q.EVENTS, key
            )
        ],
    }
    account = {"email": email, "created_at": when(created_at)}
    return account_policy.export_head(account, parts, ctx.entered_at)


def class_pages(pool: Pool, token_hash: bytes, account_id: UUID) -> Iterator[dict[str, object]]:
    """The account's classes in sync order, read a page at a time.

    Raises `ExportStopped` before a page when the session no longer enters this account. A
    class published again while the export runs moves to a later position; it is given once,
    as it was first read.
    """
    after = 0
    seen: set[tuple[object, object]] = set()
    while True:
        with site_sessions.entered(pool, token_hash) as ctx:
            if ctx is None or ctx.account_id != account_id:
                raise ExportStopped
            rows = ctx.db.rows(q.CLASS_PAGE, (account_id, after, EXPORT_PAGE))
        # The page's transaction has ended: nothing is held while the page is written.
        for row in rows:
            position = row[6]
            if not isinstance(position, int):
                raise ExportStopped
            after = position
            if (row[0], row[1]) not in seen:
                seen.add((row[0], row[1]))
                yield class_entry(row[:6])
        if len(rows) < EXPORT_PAGE:
            return


type Deletion = Literal["deleted", "not_confirmed", "gone"]


def delete(ctx: AccountContext, typed: str) -> Deletion:
    """Delete the account when `typed` is its email. Writes no event: its events go with it."""
    found = _email_and_created_at(ctx)
    if found is None:
        return "gone"
    if not confirmed(typed, found[0]):
        return "not_confirmed"
    if not ctx.db.rows(q.DELETE_ACCOUNT, (ctx.account_id,)):
        return "gone"
    revocation.notify(ctx)
    return "deleted"
