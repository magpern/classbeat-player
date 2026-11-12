"""Handles: what data access, the migration runner and the operator's commands get.

A handle runs a registered `Query` with bound parameters and returns rows. It has no method
that takes text, and it gives out no connection, cursor or transaction object of the driver.
"""

from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager
from types import TracebackType
from typing import LiteralString, cast, final

import psycopg

from player_backend.db.executor._driver import guarded
from player_backend.db.executor._errors import HandleClosed
from player_backend.db.executor._query import Query, registered_text

type Row = tuple[object, ...]
type Params = Sequence[object] | Mapping[str, object]
type _Connection = psycopg.Connection[Row]


def _fetch(connection: _Connection, text: str, params: Params | None) -> list[Row]:
    with connection.cursor() as cursor:
        # The one place text reaches the driver: always the registry's own.
        cursor.execute(cast(LiteralString, text), params)
        return cursor.fetchall() if cursor.description is not None else []


# The driver's objects, by the identity of the handle or transaction that stands for them. They
# are kept here, in the executor's own module, so that a handle has no attribute, private or
# not, that holds or returns one.
_connections: dict[int, _Connection] = {}
_transactions: dict[int, AbstractContextManager[psycopg.Transaction]] = {}


def _connection_of(handle: Handle) -> _Connection:
    connection = _connections.get(id(handle))
    if connection is None:
        raise HandleClosed("the handle's connection has been given back")
    return connection


@final
class _Transaction:
    __slots__ = ()

    def __enter__(self) -> None:
        transaction = _transactions.get(id(self))
        if transaction is None:
            raise HandleClosed("a transaction block is entered once")
        guarded(transaction.__enter__)

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        transaction = _transactions.pop(id(self))
        return bool(guarded(lambda: transaction.__exit__(exc_type, exc, traceback)))

    def __del__(self) -> None:
        _transactions.pop(id(self), None)


@final
class Handle:
    """Made by `connect` only: a handle made any other way has no connection."""

    __slots__ = ()

    def rows(self, query: Query, params: Params | None = None, /) -> list[Row]:
        """Run a registered `Query` with bound parameters. Anything else raises `NotAQuery`."""
        text = registered_text(query)
        connection = _connection_of(self)
        return guarded(lambda: _fetch(connection, text, params))

    def transaction(self) -> AbstractContextManager[None]:
        """A transaction, or a savepoint inside one. Rolled back when the block raises."""
        connection = _connection_of(self)
        transaction = _Transaction()
        _transactions[id(transaction)] = connection.transaction()
        return transaction


@contextmanager
def connect(conninfo: str) -> Generator[Handle]:
    """A handle on a connection of its own (autocommit; use `transaction()`), closed on exit."""
    connection = guarded(lambda: psycopg.connect(conninfo, autocommit=True))
    handle = Handle()
    _connections[id(handle)] = connection
    try:
        yield handle
    finally:
        del _connections[id(handle)]
        guarded(connection.close)
