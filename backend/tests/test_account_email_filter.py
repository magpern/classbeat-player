"""The account's email queries filter by the account in the code, not only by the policy (ADR
0002, section 9: "Queries still filter by `account_id` in the code; the policy is the backstop").

Here the data access runs on a handle of the bootstrap superuser, which row-level security does
not hold: whatever keeps one account's email from another in these tests is the query's own
`WHERE id = %s`. `GET /api/site/me` reads `own_email`; the export (`export_head`) and the
deletion (`delete`) read the email with the creation time. The deletion's own `DELETE` keeps to
the account by the same filter.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime

import psycopg
import pytest

from player_backend.account_policy import when
from player_backend.client_policy import ClientInfo
from player_backend.db import account
from player_backend.db.context import AccountContext
from player_backend.db.executor import Handle, connect
from player_backend.db.queries import operator as operator_q
from tests.dbhelp import Conn

A = "a@example.test"
B = "b@example.test"
_CLEAN = "TRUNCATE player.accounts CASCADE"
CLIENT = ClientInfo(network=None, family="")
# Creation times far apart, so an answer from the wrong row cannot match by chance.
CREATED = {
    A: datetime(2020, 1, 2, 3, 4, 5, tzinfo=UTC),
    B: datetime(2023, 6, 7, 8, 9, 10, tzinfo=UTC),
}


@pytest.fixture
def unheld(db_url: str) -> Iterator[tuple[Handle, Conn]]:
    """A handle that bypasses row-level security, and the tests' own connection.

    The bypass is checked, not assumed: if `db_url` stopped being a role that bypasses the
    policy, the tests below would pass for the wrong reason, so this fails first.
    """
    with psycopg.connect(db_url, autocommit=True) as su, connect(db_url) as db:
        su.execute(_CLEAN)
        try:
            _assert_unheld(db, su)
            yield db, su
        finally:
            su.execute(_CLEAN)


def _assert_unheld(db: Handle, su: Conn) -> None:
    """Fail loudly unless both the tests' connection and the handle bypass row-level security.

    Neither check goes through the functions under test: the handle's own role is read on the
    handle, and the fixture rows are read directly on the tests' connection.
    """
    bypass = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = %s"
    mine = su.execute("SELECT current_user::text").fetchone()
    assert mine is not None
    assert su.execute(bypass, mine).fetchone() == (True,), (
        "the tests' connection must bypass row-level security (superuser)"
    )
    # The role the code under test acts as, read on its own handle: row-level security applies
    # by `current_user`, so this role bypassing it means the handle is not held by the policy.
    theirs = db.rows(operator_q.CURRENT_ROLE)
    assert len(theirs) == 1
    assert su.execute(bypass, theirs[0]).fetchone() == (True,), (
        "the handle must bypass row-level security (superuser), but its role does not"
    )
    ids = {email: _account(su, email) for email in (A, B)}
    rows = su.execute("SELECT id, email FROM player.accounts ORDER BY email").fetchall()
    assert rows == [(ids[A], A), (ids[B], B)], "the fixture rows are not the two accounts made"
    su.execute(_CLEAN)


def _account(su: Conn, email: str) -> uuid.UUID:
    found = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle, created_at) "
        "VALUES (%s, sha256(convert_to(%s, 'UTF8')), %s) RETURNING id",
        (email, email, CREATED[email]),
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


def _emails(su: Conn) -> set[object]:
    return {row[0] for row in su.execute("SELECT email FROM player.accounts").fetchall()}


def test_the_export_head_keeps_to_its_account_without_the_policy(
    unheld: tuple[Handle, Conn],
) -> None:
    db, su = unheld
    a, b = _account(su, A), _account(su, B)
    for account_id, email in ((a, A), (b, B)):
        head = account.export_head(_context(db, account_id), CLIENT)
        assert head is not None
        assert head["account"] == {"email": email, "created_at": when(CREATED[email])}
    # An id that is no account's exports nothing, not some other account's email.
    assert account.export_head(_context(db, uuid.uuid4()), CLIENT) is None


def test_the_deletion_confirms_against_its_own_email_without_the_policy(
    unheld: tuple[Handle, Conn],
) -> None:
    db, su = unheld
    a, b = _account(su, A), _account(su, B)
    # Another account's email does not confirm: the confirmation reads this account's own.
    assert account.delete(_context(db, a), B) == "not_confirmed"
    assert account.delete(_context(db, b), A) == "not_confirmed"
    assert account.delete(_context(db, uuid.uuid4()), A) == "gone"
    assert _emails(su) == {A, B}


def test_the_delete_removes_only_its_account_without_the_policy(
    unheld: tuple[Handle, Conn],
) -> None:
    db, su = unheld
    a, b = _account(su, A), _account(su, B)
    assert account.delete(_context(db, a), A) == "deleted"
    # The other account is still there, and only it.
    assert _emails(su) == {B}
    found = su.execute("SELECT id FROM player.accounts").fetchall()
    assert found == [(b,)]
