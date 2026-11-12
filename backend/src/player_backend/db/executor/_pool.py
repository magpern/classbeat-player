"""The pool of the running backend's connections (ADR 0002, section 9, item 1).

Made by the executor, like every connection. A `Pool` hands out handles and nothing else: the
driver's pool is kept in this module, under the identity of the `Pool` that stands for it, so a
`Pool` has no attribute, private or not, that holds or returns a driver object.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import AbstractContextManager, contextmanager
from typing import final

import psycopg
from psycopg_pool import ConnectionPool

from player_backend.db.executor._driver import guarded
from player_backend.db.executor._errors import HandleClosed
from player_backend.db.executor._handle import Connection, Handle, Row, lend

type _DriverPool = ConnectionPool[Connection]

_pools: dict[int, _DriverPool] = {}


@contextmanager
def _borrowed(pool: _DriverPool) -> Generator[Handle]:
    connection = guarded(pool.getconn)
    try:
        with lend(connection) as handle:
            yield handle
    finally:
        # The pool rolls back whatever is still open and drops a broken connection.
        guarded(lambda: pool.putconn(connection))


@final
class Pool:
    """Made by `open_pool` only: a pool made any other way has no connection to lend."""

    __slots__ = ()

    def handle(self) -> AbstractContextManager[Handle]:
        """A handle on one pooled connection (autocommit; use `transaction()`) for the block."""
        pool = _pools.get(id(self))
        if pool is None:
            raise HandleClosed("the pool is closed")
        return _borrowed(pool)

    def close(self) -> None:
        """Close every connection. A handle asked for afterwards raises `HandleClosed`."""
        pool = _pools.pop(id(self), None)
        if pool is not None:
            guarded(pool.close)


def open_pool(
    conninfo: str, *, min_size: int = 1, max_size: int = 10, timeout: float = 5.0
) -> Pool:
    """A pool of autocommit connections. A handle waits at most `timeout` seconds for one.

    Opening does not wait for the database: the first handle does, and raises `DatabaseError`
    when no connection comes in time.
    """
    driver_pool: _DriverPool = ConnectionPool(
        conninfo,
        connection_class=psycopg.Connection[Row],
        kwargs={"autocommit": True},
        min_size=min_size,
        max_size=max_size,
        timeout=timeout,
        open=False,
    )
    guarded(driver_pool.open)
    pool = Pool()
    _pools[id(pool)] = driver_pool
    return pool
