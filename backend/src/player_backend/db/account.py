"""Data access of the account's export and its deletion (ADR 0002, sections 9, 11 and 12).

Both run in the signed-in request's transaction and filter by its account in the code.

- `export` reads the account's own rows, column by column, and writes the "export made" event.
- `delete` deletes the account row. Everything the account owns goes with it by cascade, in the
  same transaction: classes and their markers, the sync cursor, devices, source links,
  sessions, passkeys, approved pairings, link codes and audit events. The cascade runs as the
  tables' owner, so row-level security does not stop it and `player_app` needs no `DELETE` on
  those tables. Every token of the account is refused from the next request on: its row is gone.
"""

from __future__ import annotations

from typing import Literal

from player_backend.account_policy import (
    EXPORT_MAX,
    EXPORT_WINDOW,
    EXPORTED,
    confirmed,
    export_document,
    export_limit_key,
    text_or_none,
    when,
)
from player_backend.client_policy import ClientInfo
from player_backend.db.context import AccountContext
from player_backend.db.queries import account as q


def over_export_limit(ctx: AccountContext) -> bool:
    """Count one export of the account. True when it is over 3 in the day's window."""
    hit = ctx.db.rows(q.LIMIT_HIT, (export_limit_key(ctx.account_id), EXPORT_WINDOW, EXPORT_MAX))
    return hit[0][0] is not False


def _email(ctx: AccountContext) -> tuple[str, object] | None:
    found = ctx.db.rows(q.ACCOUNT, (ctx.account_id,))
    if len(found) != 1 or not isinstance(found[0][0], str):
        return None
    return found[0][0], found[0][1]


def export(ctx: AccountContext, client: ClientInfo) -> dict[str, object] | None:
    """The account's own data as one JSON object, or None when the account is gone."""
    found = _email(ctx)
    if found is None:
        return None
    email, created_at = found
    # Written first, so the export holds the event of its own making.
    ctx.db.rows(
        q.ADD_EVENT, (ctx.account_id, EXPORTED, ctx.credential_id, client.network, client.family)
    )
    key = (ctx.account_id,)
    parts: dict[str, list[dict[str, object]]] = {
        "classes": [
            {
                "source": source,
                "source_class_id": class_id,
                "publication_number": number,
                "removed": kind == "removal",
                "published_at": when(published),
                "document": document,
            }
            for source, class_id, number, kind, published, document in ctx.db.rows(q.CLASSES, key)
        ],
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
    return export_document(account, parts, ctx.entered_at)


type Deletion = Literal["deleted", "not_confirmed", "gone"]


def delete(ctx: AccountContext, typed: str) -> Deletion:
    """Delete the account when `typed` is its email. Writes no event: its events go with it."""
    found = _email(ctx)
    if found is None:
        return "gone"
    if not confirmed(typed, found[0]):
        return "not_confirmed"
    if not ctx.db.rows(q.DELETE_ACCOUNT, (ctx.account_id,)):
        return "gone"
    return "deleted"
