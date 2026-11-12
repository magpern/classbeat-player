"""The executor's pool (ADR 0002, section 9, item 1): it lends handles and nothing else, its
errors are the executor's own, and a connection carries nothing from one borrower to the next."""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import psycopg
import pytest

from player_backend.db.executor import (
    DatabaseError,
    Handle,
    HandleClosed,
    NotAQuery,
    Pool,
    open_pool,
)
from player_backend.db.queries import site_sessions as q
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash


@pytest.fixture
def pool(app_url: str) -> Iterator[Pool]:
    opened = open_pool(app_url, min_size=1, max_size=1, timeout=0.5)
    try:
        yield opened
    finally:
        opened.close()


@pytest.fixture
def session_hash(db_url: str) -> Iterator[tuple[uuid.UUID, bytes]]:
    """A committed account with one session: (account id, the session token's hash)."""
    digest = token_hash(new_token("ses"))
    with psycopg.connect(db_url, autocommit=True) as su:
        row = su.execute(
            "INSERT INTO player.accounts (email, passkey_user_handle) "
            "VALUES ('pool@example.test', decode(repeat('cd', 32), 'hex')) RETURNING id"
        ).fetchone()
        assert row is not None and isinstance(row[0], uuid.UUID)
        su.execute(
            "INSERT INTO player.sessions (account_id, token_hash) VALUES (%s, %s)", (row[0], digest)
        )
        try:
            yield row[0], digest
        finally:
            su.execute("DELETE FROM player.accounts WHERE id = %s", (row[0],))


def _account(db: Handle) -> object:
    return db.rows(q.CURRENT_ACCOUNT)[0][0]


def test_a_pooled_handle_runs_registered_queries_only(pool: Pool) -> None:
    with pool.handle() as db:
        assert isinstance(db, Handle)
        assert _account(db) is None
        with pytest.raises(NotAQuery):
            db.rows("SELECT 1")  # pyright: ignore[reportArgumentType]


def test_a_handle_is_closed_when_its_block_ends(pool: Pool) -> None:
    with pool.handle() as db:
        pass
    with pytest.raises(HandleClosed):
        db.rows(q.CURRENT_ACCOUNT)
    with pytest.raises(HandleClosed):
        db.transaction()


def test_a_pool_made_any_other_way_or_closed_lends_nothing(app_url: str) -> None:
    with pytest.raises(HandleClosed):
        Pool().handle()
    opened = open_pool(app_url, max_size=1)
    opened.close()
    opened.close()  # closing twice is fine
    with pytest.raises(HandleClosed):
        opened.handle()


def test_a_pool_has_no_attribute_and_gives_out_no_driver_object(pool: Pool) -> None:
    assert Pool.__slots__ == () and not hasattr(pool, "__dict__")
    public = sorted(name for name in dir(pool) if not name.startswith("_"))
    assert public == ["close", "handle"]
    with pool.handle() as db:
        for thing in (pool, db, pool.handle):
            assert not type(thing).__module__.startswith("psycopg")
        assert db.rows(q.CURRENT_ACCOUNT)[0][0] is None


def _no_driver_object(error: DatabaseError) -> None:
    assert error.__cause__ is None and error.__context__ is None
    for value in (*error.args, *vars(error).values()):
        assert not type(value).__module__.startswith("psycopg")


def test_waiting_too_long_for_a_connection_is_the_executors_error(pool: Pool) -> None:
    with pool.handle():
        with pytest.raises(DatabaseError) as raised:
            with pool.handle():
                pass
    _no_driver_object(raised.value)
    # The pool still works once the connection is back.
    with pool.handle() as db:
        assert _account(db) is None


def test_no_database_is_the_executors_error_at_the_first_handle() -> None:
    # Opening waits for nothing (the app starts without a database); the first handle fails.
    unreachable = open_pool("postgresql://player_app@127.0.0.1:1/none", timeout=0.3)
    try:
        with pytest.raises(DatabaseError) as raised:
            with unreachable.handle():
                pass
        _no_driver_object(raised.value)
    finally:
        unreachable.close()


def test_an_account_set_for_one_borrower_is_gone_for_the_next(
    pool: Pool, session_hash: tuple[uuid.UUID, bytes]
) -> None:
    account, digest = session_hash
    with pool.handle() as db, db.transaction():
        assert len(db.rows(q.ENTER_SESSION, (digest,))) == 1
        assert _account(db) == account
    # The pool has one connection: this is the same one, in a new transaction.
    with pool.handle() as db:
        assert _account(db) is None
        with db.transaction():
            assert _account(db) is None


def test_a_connection_given_back_inside_a_transaction_is_rolled_back(
    pool: Pool, session_hash: tuple[uuid.UUID, bytes]
) -> None:
    account, digest = session_hash
    with pytest.raises(RuntimeError):
        with pool.handle() as db, db.transaction():
            db.rows(q.ENTER_SESSION, (digest,))
            raise RuntimeError("the request failed")
    with pool.handle() as db:
        assert _account(db) is None
    # A transaction entered and never left: the pool rolls it back when the handle goes.
    with pool.handle() as db:
        left_open = db.transaction()
        left_open.__enter__()
        db.rows(q.ENTER_SESSION, (digest,))
        assert _account(db) == account
    with pool.handle() as db:
        assert _account(db) is None
