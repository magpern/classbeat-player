"""The class sync queries filter by the account in the code, not only by the policy (ADR 0002,
section 9: "Queries still filter by `account_id` in the code; the policy is the backstop").

Here the data access runs on a handle of the bootstrap superuser, which row-level security
does not hold: whatever keeps one account's classes and cursor from another in these tests is
the query's own filter.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import psycopg
import pytest

from player_backend.db import class_sync
from player_backend.db.context import AccountContext
from player_backend.db.executor import Handle, connect
from player_backend.publication_policy import content_hash
from tests import sourcehelp as sh
from tests.dbhelp import Conn

_CLEAN = "TRUNCATE player.accounts CASCADE"


@pytest.fixture
def unheld(db_url: str) -> Iterator[tuple[Handle, Conn]]:
    """A handle that bypasses row-level security, and the tests' own connection."""
    with psycopg.connect(db_url, autocommit=True) as su, connect(db_url) as db:
        su.execute(_CLEAN)
        try:
            yield db, su
        finally:
            su.execute(_CLEAN)


def _account(su: Conn, email: str, classes: int) -> tuple[uuid.UUID, list[uuid.UUID]]:
    """An account with `classes` classes, the last of them removed: (account id, class ids)."""
    account = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES (%s, sha256(convert_to(%s, 'UTF8'))) RETURNING id",
        (email, email),
    ).fetchone()
    assert account is not None and isinstance(account[0], uuid.UUID)
    doc = sh.document(email)
    ids: list[uuid.UUID] = []
    for n in range(1, classes + 1):
        removed = n == classes
        row = su.execute(
            "INSERT INTO player.classes (account_id, source_id, source_class_id, "
            "publication_number, kind, content_hash, published_at, sync_position, document) "
            "VALUES (%s, 'classbeat', %s, %s, %s, %s, now(), %s, %s::jsonb) RETURNING id",
            (
                account[0],
                f"c{n}",
                n,
                "removal" if removed else "class",
                None if removed else content_hash(doc),
                n,
                None if removed else json.dumps(doc),
            ),
        ).fetchone()
        assert row is not None and isinstance(row[0], uuid.UUID)
        ids.append(row[0])
    su.execute(
        "INSERT INTO player.account_sync (account_id, position) VALUES (%s, %s)",
        (account[0], classes),
    )
    return account[0], ids


def _context(db: Handle, account: uuid.UUID) -> AccountContext:
    return AccountContext(
        account_id=account,
        credential_kind="device",
        credential_id=uuid.uuid4(),
        signed_in_at=None,
        entered_at=datetime.now(UTC),
        db=db,
    )


def test_the_class_sync_queries_keep_to_their_account_without_the_policy(
    unheld: tuple[Handle, Conn],
) -> None:
    db, su = unheld
    a, a_ids = _account(su, "a@example.test", 2)
    b, b_ids = _account(su, "b@example.test", 5)
    # The handle is not held by the policy: it sees both accounts' rows.
    assert su.execute("SELECT count(*) FROM player.classes").fetchone() == (7,)
    as_a = _context(db, a)
    assert class_sync.cursor(as_a) == 2
    page = class_sync.changes(as_a, 0, 500)
    assert [change.id for change in page.changes] == a_ids
    assert (page.cursor, page.more) == (2, False)
    assert [change.removed for change in page.changes] == [False, True]
    # B's places above A's cursor are not A's.
    assert list(class_sync.changes(as_a, 2, 500).changes) == []
    # Another account's class id finds nothing; nor does A's own removal marker.
    for class_id in (*b_ids, a_ids[1]):
        assert class_sync.held_class(as_a, class_id) is None
    held = class_sync.held_class(as_a, a_ids[0])
    assert held is not None and held.document["class"]["title"] == "a@example.test"
    # And B reads its own, all of it.
    as_b = _context(db, b)
    assert class_sync.cursor(as_b) == 5
    assert [change.id for change in class_sync.changes(as_b, 0, 500).changes] == b_ids
    # A placeholder (number 0) is never committed by a publication. Should one ever be, with a
    # place in the order, sync still does not show it: the player API takes numbers above 0.
    su.execute(
        "INSERT INTO player.classes (account_id, source_id, source_class_id, "
        "publication_number, sync_position) VALUES (%s, 'classbeat', 'placeholder', 0, 1)",
        (a,),
    )
    assert [change.id for change in class_sync.changes(as_a, 0, 500).changes] == a_ids
    # An account with no sync row yet has cursor 0 and no changes.
    assert class_sync.cursor(_context(db, uuid.uuid4())) == 0
    assert list(class_sync.changes(_context(db, uuid.uuid4()), 0, 1).changes) == []
