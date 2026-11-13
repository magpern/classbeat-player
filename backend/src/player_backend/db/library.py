"""Data access of the class library for the site (plan, section 5; ADR 0002, sections 7, 9,
11 and 12): list the account's classes, read one, delete one.

Takes the `AccountContext` of a signed-in request and filters by its account in the code. A
class is found by its own id only together with the account: another account's id finds
nothing, the same as an id that does not exist.

Deleting a class writes the marker of a removal at the highest number seen (ADR 0002,
section 7): the document and its hash go at once, and the row takes the next place in the
account's sync order, so every device learns of it at its next sync. A later, higher-numbered
publication from the source stores the class again. Deleting a marker changes nothing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, cast
from uuid import UUID

from player_backend.client_policy import ClientInfo
from player_backend.db.context import AccountContext
from player_backend.db.queries import classes as cq
from player_backend.db.queries import library as q
from player_backend.library_policy import PageRequest, length_of, title_of

# Section 11: "class deleted on the site".
DELETED: Final = "class.deleted"


@dataclass(frozen=True)
class LibraryEntry:
    """A class row as the list shows it: no content but its title and length, and neither of
    those for a marker."""

    id: UUID
    source_id: str
    source_class_id: str
    publication_number: int
    removed: bool
    title: str | None
    length_ms: int | None
    changed_at: datetime
    position: int


@dataclass(frozen=True)
class LibraryPage:
    entries: list[LibraryEntry]
    # The place of the page's last row, for `before` of the next page; None for an empty page.
    cursor: int | None
    more: bool


@dataclass(frozen=True)
class LibraryClass:
    id: UUID
    source_id: str
    source_class_id: str
    publication_number: int
    content_hash: str
    changed_at: datetime
    document: dict[str, Any]


def _int(value: object) -> int:
    assert isinstance(value, int) and not isinstance(value, bool)
    return value


def list_classes(ctx: AccountContext, page: PageRequest) -> LibraryPage:
    """One page of the account's classes and markers, the latest change first."""
    rows = ctx.db.rows(q.LIST_CLASSES, (ctx.account_id, page.before, page.before, page.limit + 1))
    entries: list[LibraryEntry] = []
    for row_id, source_id, source_class_id, number, removed, at, place, title, length in rows:
        gone = removed is True
        entries.append(
            LibraryEntry(
                cast(UUID, row_id),
                cast(str, source_id),
                cast(str, source_class_id),
                _int(number),
                gone,
                title_of(gone, title),
                length_of(gone, length),
                cast(datetime, at),
                _int(place),
            )
        )
    kept = entries[: page.limit]
    return LibraryPage(kept, kept[-1].position if kept else None, len(entries) > page.limit)


def read_class(ctx: AccountContext, class_id: UUID) -> LibraryClass | None:
    """One class the account holds now, with its document; None for anything else."""
    found = ctx.db.rows(q.READ_CLASS, (ctx.account_id, class_id))
    if len(found) != 1:
        return None
    source_id, source_class_id, number, stored_hash, at, document = found[0]
    assert isinstance(document, dict)
    return LibraryClass(
        class_id,
        cast(str, source_id),
        cast(str, source_class_id),
        _int(number),
        cast(str, stored_hash),
        cast(datetime, at),
        cast("dict[str, Any]", document),
    )


def delete_class(ctx: AccountContext, class_id: UUID, client: ClientInfo) -> bool:
    """Delete one class of the account. True when it is gone now, whether by this call or
    before it; False when the account has no class row with that id."""
    found = ctx.db.rows(q.LOCK_FOR_DELETE, (ctx.account_id, class_id))
    if len(found) != 1:
        return False
    kind, source_id, source_class_id, number = found[0]
    if kind != "class":
        # Already a marker: nothing to delete, and no new place in the sync order.
        return True
    # The sync cursor's lock is taken after the class row's, as a publication takes them.
    ctx.db.rows(cq.SYNC_ROW, (ctx.account_id,))
    position = _int(ctx.db.rows(cq.SYNC_NEXT, (ctx.account_id,))[0][0])
    marked = ctx.db.rows(q.MARK_DELETED, (position, ctx.account_id, class_id))
    assert len(marked) == 1
    # No title and no content (section 11): the class's id, key and number.
    detail = {
        "class_id": str(class_id),
        "source": cast(str, source_id),
        "source_class_id": cast(str, source_class_id),
        "publication_number": _int(number),
    }
    ctx.db.rows(
        q.ADD_LIBRARY_EVENT,
        (
            ctx.account_id,
            DELETED,
            ctx.credential_kind,
            ctx.credential_id,
            client.network,
            client.family,
            json.dumps(detail),
        ),
    )
    return True
