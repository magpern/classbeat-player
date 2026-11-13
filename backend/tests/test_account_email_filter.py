"""The account's email queries filter by the account in the code, not only by the policy (ADR
0002, section 9: "Queries still filter by `account_id` in the code; the policy is the backstop").

Here the data access runs on a handle of the bootstrap superuser, which row-level security does
not hold: whatever keeps one account's email from another in these tests is the query's own
`WHERE id = %s`. `GET /api/site/me` reads `own_email`; the export and the deletion read
`_email_and_created_at`.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import psycopg
import pytest

from player_backend.db import account
from player_backend.db.context import AccountContext
from player_backend.db.executor import Handle, connect
from tests.dbhelp import Conn

A = "a@example.test"
B = "b@example.test"
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


def _account(su: Conn, email: str) -> uuid.UUID:
    found = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES (%s, sha256(convert_to(%s, 'UTF8'))) RETURNING id",
        (email, email),
    ).fetchone()
    assert found is not None and isinstance(found[0], uuid.UUID)
    return found[0]


def _context(db: Handle, account_id: uuid.UUID) -> AccountContext:
    return AccountContext(
        account_id=account_id,
        credential_kind="session",
        credential_id=uuid.uuid4(),
        signed_in_at=None,
        entered_at=datetime.now(UTC),
        db=db,
    )


def test_the_me_email_keeps_to_its_account_without_the_policy(
    unheld: tuple[Handle, Conn],
) -> None:
    db, su = unheld
    a, b = _account(su, A), _account(su, B)
    # The handle is not held by the policy: it sees both accounts.
    assert su.execute("SELECT count(*) FROM player.accounts").fetchone() == (2,)
    assert account.own_email(_context(db, a)) == A
    assert account.own_email(_context(db, b)) == B
    # An id that is no account's finds nothing, not some other account's email.
    assert account.own_email(_context(db, uuid.uuid4())) is None


def test_the_export_and_deletion_email_keeps_to_its_account_without_the_policy(
    unheld: tuple[Handle, Conn],
) -> None:
    db, su = unheld
    a, b = _account(su, A), _account(su, B)
    read = account._email_and_created_at  # pyright: ignore[reportPrivateUsage]
    found_a, found_b = read(_context(db, a)), read(_context(db, b))
    assert found_a is not None and found_a[0] == A
    assert found_b is not None and found_b[0] == B
    assert read(_context(db, uuid.uuid4())) is None
