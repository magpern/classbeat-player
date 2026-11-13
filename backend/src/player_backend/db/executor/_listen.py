"""A listening connection: the live process's own, for the `live_revocations` notices (ADR 0002,
section 8).

Made by the executor, like every connection: a connection of its own, autocommit, direct to the
database (never a pooled one, so never through a transaction pooler). Its handle runs the
`LISTEN`, a registered `Query` like every statement; after that the listener waits for
notices. A `Listener` hands out the notices' payloads as text and nothing else: the driver's
connection is kept in this module, under the identity of the `Listener` that stands for it.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from typing import final

import psycopg

from player_backend.db.executor._driver import guarded
from player_backend.db.executor._errors import HandleClosed
from player_backend.db.executor._handle import Connection, Handle, lend

_connections: dict[int, Connection] = {}


def _payloads(connection: Connection, timeout: float) -> list[str]:
    # The first batch that arrives, or nothing within `timeout`: notices that came together
    # are handed out together, and any later ones by the next wait.
    return [notice.payload for notice in connection.notifies(timeout=timeout, stop_after=1)]


@final
class Listener:
    """Made by `listen` only: a listener made any other way has no connection."""

    __slots__ = ()

    def wait(self, timeout: float) -> list[str]:
        """The payloads of the notices that arrive within `timeout` seconds (maybe none).

        A lost connection raises `DatabaseError`; the caller opens a new listener.
        """
        connection = _connections.get(id(self))
        if connection is None:
            raise HandleClosed("the listener's connection has been closed")
        return guarded(lambda: _payloads(connection, max(0.0, timeout)))


@contextmanager
def listen(conninfo: str) -> Generator[tuple[Handle, Listener]]:
    """A connection of its own (autocommit), as a handle to run its `LISTEN` with and a
    listener to wait on. Closed on exit."""
    connection = guarded(lambda: psycopg.connect(conninfo, autocommit=True))
    listener = Listener()
    try:
        with lend(connection) as handle:
            _connections[id(listener)] = connection
            yield handle, listener
    finally:
        _connections.pop(id(listener), None)
        guarded(connection.close)
