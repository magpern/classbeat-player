"""The run-time layer of ADR 0002, section 9, item 1, through the public interface.

A handle runs a registered `Query` and nothing else, runs the registry's text whatever happens
to the object or to its name, and lets no driver object out: not as a return value, a public
attribute or a raised exception.
"""

from __future__ import annotations

from typing import Any, cast

import psycopg
import pytest
from psycopg import sql

from player_backend.db.executor import (
    DatabaseError,
    ExecutorError,
    Handle,
    HandleClosed,
    NotAQuery,
    Query,
    RegistryFrozen,
    connect,
)
from player_backend.db.migrate import apply_migrations
from player_backend.db.queries import migrations as q

INSERT = "INSERT INTO player_meta.schema_migrations (version, name, sha256) VALUES (77, 'x', 'x')"


class _Text(str):
    pass


class _Abort(Exception):
    pass


def _ledger(db_url: str) -> list[tuple[object, ...]]:
    with psycopg.connect(db_url) as conn:
        return conn.execute("SELECT version, sha256 FROM player_meta.schema_migrations").fetchall()


def _from_the_driver(value: object) -> bool:
    return type(value).__module__.split(".")[0] in ("psycopg", "psycopg_binary", "psycopg_pool")


def _reachable(error: BaseException) -> list[object]:
    """What ordinary code gets from a raised exception: its chain, arguments and attributes."""
    found: list[object] = []
    seen: set[int] = set()
    todo: list[BaseException] = [error]
    while todo:
        current = todo.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        found.extend([current, *current.args, *vars(current).values()])
        todo.extend(e for e in (current.__cause__, current.__context__) if e is not None)
    return found


REFUSED: list[tuple[str, object]] = [
    ("str", INSERT),
    ("str subclass", _Text(INSERT)),
    ("bytes", INSERT.encode()),
    ("sql.SQL", sql.SQL(INSERT)),
    ("Composed", sql.SQL("{}").format(sql.SQL(INSERT))),
    ("unregistered Query", object.__new__(Query)),
    ("a list holding a Query", [q.LOCK]),
    ("None", None),
]


@pytest.mark.parametrize("statement", [s for _, s in REFUSED], ids=[n for n, _ in REFUSED])
def test_anything_but_a_registered_query_is_refused(
    statement: object, owner_db: Handle, db_url: str
) -> None:
    before = _ledger(db_url)
    with pytest.raises(NotAQuery):
        owner_db.rows(cast(Any, statement))
    with pytest.raises(NotAQuery), owner_db.transaction():
        owner_db.rows(cast(Any, statement), ())
    assert _ledger(db_url) == before


def test_a_registered_query_runs_with_bound_parameters_and_returns_rows(
    owner_db: Handle, db_url: str
) -> None:
    before = _ledger(db_url)
    assert sorted(owner_db.rows(q.APPLIED)) == sorted(before)
    with pytest.raises(_Abort), owner_db.transaction():
        assert owner_db.rows(q.RECORD, (77, "'); DROP TABLE player.accounts; --", "x")) == []
        rows = owner_db.rows(q.APPLIED)
        assert type(rows) is list and all(type(row) is tuple for row in rows)
        assert (77, "x") in rows
        raise _Abort
    assert _ledger(db_url) == before


def test_a_rebound_name_is_refused_when_it_is_run(
    owner_db: Handle, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(RegistryFrozen):
        monkeypatch.setattr(q, "LOCK", Query("SELECT pg_sleep(0)"))
    monkeypatch.setattr(q, "LOCK", "SELECT pg_sleep(0)")
    with pytest.raises(NotAQuery):
        apply_migrations(owner_db)
    monkeypatch.setattr(q, "LOCK", object.__new__(Query))
    with pytest.raises(NotAQuery):
        apply_migrations(owner_db)


def test_an_object_changed_in_place_still_runs_its_registered_text(
    owner_db: Handle, db_url: str
) -> None:
    query: Any = q.APPLIED
    for change in (
        lambda: setattr(query, "text", INSERT),
        lambda: object.__setattr__(query, "_text", INSERT),
        lambda: query.__init__(INSERT),
    ):
        try:
            change()
        except (AttributeError, TypeError):
            pass
    before = _ledger(db_url)
    assert sorted(owner_db.rows(q.APPLIED)) == sorted(before)
    assert _ledger(db_url) == before


@pytest.mark.parametrize("in_transaction", [False, True])
def test_a_driver_error_becomes_the_executors_own_with_no_chain_to_it(
    owner_db: Handle, in_transaction: bool
) -> None:
    with pytest.raises(DatabaseError) as raised:
        if in_transaction:
            with owner_db.transaction():
                owner_db.rows(q.RECORD, (1, "again", "x"))
        else:
            owner_db.rows(q.RECORD, (1, "again", "x"))
    error = raised.value
    assert error.sqlstate == "23505"
    assert error.__cause__ is None and error.__context__ is None
    assert str(error) == 'duplicate key value violates unique constraint "schema_migrations_pkey"'
    assert not any(_from_the_driver(value) for value in _reachable(error))


def test_driver_errors_without_a_sqlstate_are_converted_too(owner_db: Handle) -> None:
    with pytest.raises(DatabaseError) as raised:
        owner_db.rows(q.RECORD, (1,))
    assert raised.value.sqlstate is None
    assert not any(_from_the_driver(value) for value in _reachable(raised.value))
    with pytest.raises(DatabaseError) as refused:
        with connect("postgresql://nobody@127.0.0.1:1/nothing?connect_timeout=2"):
            pass
    assert refused.value.__cause__ is None and refused.value.__context__ is None
    assert not any(_from_the_driver(value) for value in _reachable(refused.value))


def test_an_error_raised_while_another_is_handled_keeps_only_that_one(owner_db: Handle) -> None:
    with pytest.raises(DatabaseError) as raised:
        try:
            raise _Abort
        except _Abort:
            owner_db.rows(q.RECORD, (1, "again", "x"))
    assert not any(_from_the_driver(value) for value in _reachable(raised.value))


def test_a_handle_and_its_transaction_have_no_public_driver_object(owner_db: Handle) -> None:
    transaction = owner_db.transaction()
    assert [name for name in dir(owner_db) if not name.startswith("_")] == ["rows", "transaction"]
    assert [name for name in dir(transaction) if not name.startswith("_")] == []
    with transaction as entered:
        assert entered is None
    for value in (owner_db, transaction, owner_db.rows, owner_db.transaction):
        assert not _from_the_driver(value)
        assert not hasattr(value, "__dict__") or not vars(value)


def test_a_handle_is_dead_once_its_connection_is_given_back(owner_url: str) -> None:
    with connect(owner_url) as db:
        assert db.rows(q.LOCK) != []
    for use in (lambda: db.rows(q.LOCK), db.transaction):
        with pytest.raises(HandleClosed):
            use()


def test_every_error_of_the_executor_is_its_own_type() -> None:
    for error in (DatabaseError, NotAQuery, HandleClosed, RegistryFrozen):
        assert issubclass(error, ExecutorError) and error.__module__.startswith("player_backend.")
