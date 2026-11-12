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


@final
class _Transaction:
    __slots__ = ("_driver_transaction",)

    def __init__(self, connection: _Connection) -> None:
        self._driver_transaction = connection.transaction()

    def __enter__(self) -> None:
        guarded(self._driver_transaction.__enter__)

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        transaction = self._driver_transaction
        return bool(guarded(lambda: transaction.__exit__(exc_type, exc, traceback)))


@final
class Handle:
    __slots__ = ("_driver_connection",)

    def __init__(self, connection: _Connection) -> None:
        self._driver_connection: _Connection | None = connection

    def _connection(self) -> _Connection:
        if self._driver_connection is None:
            raise HandleClosed("the handle's connection has been given back")
        return self._driver_connection

    def rows(self, query: Query, params: Params | None = None, /) -> list[Row]:
        """Run a registered `Query` with bound parameters. Anything else raises `NotAQuery`."""
        text = registered_text(query)
        connection = self._connection()
        return guarded(lambda: _fetch(connection, text, params))

    def transaction(self) -> AbstractContextManager[None]:
        """A transaction, or a savepoint inside one. Rolled back when the block raises."""
        return _Transaction(self._connection())

    def _close(self) -> None:
        connection, self._driver_connection = self._driver_connection, None
        if connection is not None:
            guarded(connection.close)


@contextmanager
def connect(conninfo: str) -> Generator[Handle]:
    """A handle on a connection of its own (autocommit; use `transaction()`), closed on exit."""
    handle = Handle(guarded(lambda: psycopg.connect(conninfo, autocommit=True)))
    try:
        yield handle
    finally:
        handle._close()  # pyright: ignore[reportPrivateUsage]
