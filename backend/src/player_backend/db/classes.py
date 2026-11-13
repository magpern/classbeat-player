"""Data access of publications into the class library (ADR 0002, section 7; ADR 0003, s. 6).

A class is keyed by account, source id and `source_class_id`; the source id is the token's,
never the body's. The decision is made in the request's transaction, under the class row's lock
(a placeholder row with number 0 is made first, so a first publication has a row to lock too).
A refusal is returned, and the caller rolls back what was written for it.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Final, Literal
from uuid import UUID

from player_backend.db.context import AccountContext
from player_backend.db.queries import classes as q
from player_backend.publication_policy import Publication, outcome
from player_backend.sync_policy import BASE_END, BASE_MIN, base_of

# Section 7: an account holds at most 2,000 classes (rows that hold a document).
MAX_CLASSES: Final = 2000

type Outcome = Literal["applied", "repeat", "stale", "conflict", "class_limit"]
REFUSED: Final[frozenset[Outcome]] = frozenset({"stale", "conflict", "class_limit"})


@dataclass(frozen=True)
class Decision:
    outcome: Outcome
    # The row's number after the decision: the highest number seen.
    highest: int


@dataclass(frozen=True)
class Highest:
    number: int
    removed: bool


def _int(value: object) -> int:
    assert isinstance(value, int) and not isinstance(value, bool)
    return value


def publish(ctx: AccountContext, source_id: str, pub: Publication) -> Decision:
    """Apply `pub` for the account and the token's source, or say why it is refused.

    For a refusal the caller must roll back: the placeholder row may have been written.
    """
    key = (ctx.account_id, source_id, pub.source_class_id)
    ctx.db.rows(q.PLACEHOLDER, key)
    row_id, number, kind, stored_hash, holds_document = ctx.db.rows(q.LOCK_CLASS, key)[0]
    assert isinstance(row_id, UUID)
    highest = _int(number)
    found = outcome(highest, kind == "removal", _hash(stored_hash), pub)
    if found == "repeat":
        return Decision("repeat", highest)
    if found == "stale" or found == "conflict":
        return Decision(found, highest)
    position = next_position(ctx)
    # Counted under the sync cursor's lock, so two new classes of one account cannot both pass.
    if not pub.removed and holds_document is not True:
        held = _int(ctx.db.rows(q.COUNT_HELD, (ctx.account_id,))[0][0])
        if held >= MAX_CLASSES:
            return Decision("class_limit", highest)
    ctx.db.rows(
        q.APPLY,
        (
            pub.number,
            "removal" if pub.removed else "class",
            pub.content_hash,
            position,
            pub.document,
            ctx.account_id,
            row_id,
        ),
    )
    return Decision("applied", pub.number)


def next_position(ctx: AccountContext) -> int:
    """The account's next place in its sync order, under the sync row's lock until the
    transaction ends. The row is made at the first change, starting at a random base."""
    base = base_of(secrets.randbelow(BASE_END - BASE_MIN))
    ctx.db.rows(q.SYNC_ROW, (ctx.account_id, base, base))
    return _int(ctx.db.rows(q.SYNC_NEXT, (ctx.account_id,))[0][0])


def _hash(value: object) -> str | None:
    return value if isinstance(value, str) else None


def highest(ctx: AccountContext, source_id: str, source_class_id: str) -> Highest | None:
    """The highest number seen for one class of this source, or None when there is none."""
    found = ctx.db.rows(q.HIGHEST, (ctx.account_id, source_id, source_class_id))
    if len(found) != 1:
        return None
    number, kind = found[0]
    return Highest(_int(number), kind == "removal")
