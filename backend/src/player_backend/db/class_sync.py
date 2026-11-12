"""Data access of class sync for the player API (ADR 0002, sections 6, 7 and 9). Read only.

Takes the `AccountContext` of a device-token request and filters by its account in the code.
A class row is found by its own id only together with the account: another account's id finds
nothing, the same as an id that does not exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast
from uuid import UUID

from player_backend.db.context import AccountContext
from player_backend.db.queries import class_sync as q
from player_backend.sync_policy import Page, page_of


@dataclass(frozen=True)
class Change:
    """A class row as sync shows it: its key, its number, its kind and hash. No content."""

    id: UUID
    source_id: str
    source_class_id: str
    publication_number: int
    removed: bool
    content_hash: str | None
    published_at: datetime
    position: int


@dataclass(frozen=True)
class HeldClass:
    id: UUID
    source_id: str
    source_class_id: str
    publication_number: int
    content_hash: str
    position: int
    document: dict[str, Any]


def _int(value: object) -> int:
    assert isinstance(value, int) and not isinstance(value, bool)
    return value


def cursor(ctx: AccountContext) -> int:
    """The account's current cursor: 0 before its first publication."""
    return _int(ctx.db.rows(q.CURSOR, (ctx.account_id,))[0][0])


def changes(ctx: AccountContext, after: int, limit: int) -> Page[Change]:
    """The account's changes after the cursor `after`, at most `limit`, in sync order."""
    rows = ctx.db.rows(q.CHANGES, (ctx.account_id, after, limit + 1))
    found = [
        Change(
            cast(UUID, row_id),
            cast(str, source_id),
            cast(str, source_class_id),
            _int(number),
            kind == "removal",
            cast("str | None", stored_hash),
            cast(datetime, published_at),
            _int(position),
        )
        for (
            row_id,
            source_id,
            source_class_id,
            number,
            kind,
            stored_hash,
            published_at,
            position,
        ) in rows
    ]
    return page_of(found, [change.position for change in found], after, limit)


def held_class(ctx: AccountContext, class_id: UUID) -> HeldClass | None:
    """One class the account holds now, with its document; None for anything else."""
    found = ctx.db.rows(q.ONE_CLASS, (ctx.account_id, class_id))
    if len(found) != 1:
        return None
    source_id, source_class_id, number, stored_hash, position, document = found[0]
    assert isinstance(document, dict)
    return HeldClass(
        class_id,
        cast(str, source_id),
        cast(str, source_class_id),
        _int(number),
        cast(str, stored_hash),
        _int(position),
        cast("dict[str, Any]", document),
    )
