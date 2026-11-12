"""The executor's own error types. None of them carries a driver object or a statement's text."""

from __future__ import annotations


class ExecutorError(Exception):
    """Base of everything the executor raises."""


class NotAQuery(ExecutorError):
    """The statement is not a registered `Query`: text, a driver type, a copy or a stranger."""


class RegistryFrozen(ExecutorError):
    """A `Query` was made outside the load of the fixed list (before it, or after the freeze)."""


class RegistryNotFrozen(ExecutorError):
    """Something was run before the registry was frozen."""


class QuerySourceError(ExecutorError):
    """A `Query` was made from something other than text, or from a file not in the fixed list."""


class HandleClosed(ExecutorError):
    """The handle's connection has been given back."""


class DatabaseError(ExecutorError):
    """A failure reported by the database or the driver, as the executor's own type.

    `sqlstate` is PostgreSQL's five-character code, or None when the failure has none (no
    connection, wrong number of parameters). The message is the server's primary message only:
    never its detail line, which can hold row values.
    """

    def __init__(self, message: str, sqlstate: str | None) -> None:
        super().__init__(message)
        self.sqlstate = sqlstate
