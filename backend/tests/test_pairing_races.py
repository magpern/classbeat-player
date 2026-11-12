"""Two callers at once (ADR 0002, section 6): tries of one account's codes are counted one at a
time, and two polls of one device code cannot both collect the token.

Two connections of the tests' own driver. The second caller is seen to wait for the first (a
short lock timeout stands in for the wait), and then to see what the first one committed.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import psycopg
import pytest
from psycopg import errors

from tests.dbhelp import Conn, set_account

FIND = "SELECT platform FROM player.auth_find_pairing(%s)"
COLLECT = (
    "SELECT state FROM player.auth_collect_pairing(%s, %s, ROW(NULL, 'Other')::player.client_info)"
)
DECIDE = (
    "SELECT player.auth_decide_pairing("
    "%s, true, 'Studio PC', ROW(NULL, 'Other')::player.client_info)"
)
_CLEAN = "TRUNCATE player.accounts, player.pairings, player.rate_limits CASCADE"


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


@pytest.fixture
def two(db_url: str) -> Iterator[tuple[Conn, Conn]]:
    with psycopg.connect(db_url) as first, psycopg.connect(db_url) as second:
        first.execute(_CLEAN)
        first.commit()
        try:
            yield first, second
        finally:
            second.rollback()
            first.rollback()
            first.execute(_CLEAN)
            first.commit()


def _seed(conn: Conn) -> tuple[uuid.UUID, bytes, bytes]:
    """A committed account and pending pairing: (account, device code hash, user code hash)."""
    row = conn.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES ('rider@example.test', decode(repeat('ab', 32), 'hex')) RETURNING id"
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    device, user = _h(), _h()
    conn.execute("SELECT player.auth_start_pairing(%s, %s, 'linux', '1')", (device, user))
    conn.commit()
    return row[0], device, user


def _impatient(conn: Conn, account: uuid.UUID | None = None) -> None:
    conn.execute("SET LOCAL lock_timeout = '300ms'")
    if account is not None:
        set_account(conn, account)


def test_tries_of_one_accounts_codes_are_counted_one_at_a_time(two: tuple[Conn, Conn]) -> None:
    first, second = two
    account, _, user = _seed(first)
    # Four wrong codes are committed. The fifth is tried and not committed yet.
    for _ in range(4):
        set_account(first, account)
        assert first.execute(FIND, (_h(),)).fetchall() == []
        first.commit()
    set_account(first, account)
    assert first.execute(FIND, (_h(),)).fetchall() == []
    # A try sent at the same time is not compared before the fifth has been counted.
    _impatient(second, account)
    with pytest.raises(errors.LockNotAvailable):
        second.execute(FIND, (user,))
    second.rollback()
    first.commit()
    # Now it is: the form is closed, so even the right code finds nothing.
    _impatient(second, account)
    assert second.execute(FIND, (user,)).fetchall() == []


def test_two_polls_at_once_collect_one_token(two: tuple[Conn, Conn]) -> None:
    first, second = two
    account, device, user = _seed(first)
    set_account(first, account)
    assert first.execute(DECIDE, (user,)).fetchone() == (True,)
    first.commit()
    assert first.execute(COLLECT, (device, _h())).fetchall() == [("ok",)]
    # The second poll waits for the first one's transaction.
    _impatient(second)
    with pytest.raises(errors.LockNotAvailable):
        second.execute(COLLECT, (device, _h()))
    second.rollback()
    first.commit()
    _impatient(second)
    assert second.execute(COLLECT, (device, _h())).fetchall() == [("expired_token",)]
    assert second.execute("SELECT count(*) FROM player.devices").fetchone() == (1,)
