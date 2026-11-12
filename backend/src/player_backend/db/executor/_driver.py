"""Calls into the driver, with its errors turned into the executor's own type.

`DatabaseError` is raised after the `except` block has ended, so the driver's exception is
neither its `__cause__` nor its `__context__`: no driver object leaves the executor that way.
"""

from __future__ import annotations

from collections.abc import Callable

import psycopg

from player_backend.db.executor._errors import DatabaseError


def _converted(error: psycopg.Error) -> DatabaseError:
    message = error.diag.message_primary or f"database error ({type(error).__name__})"
    return DatabaseError(message, error.sqlstate)


def guarded[T](call: Callable[[], T]) -> T:
    """Run `call`; a driver error becomes a `DatabaseError` with no chain to it."""
    try:
        return call()
    except psycopg.Error as error:
        failure = _converted(error)
    raise failure
