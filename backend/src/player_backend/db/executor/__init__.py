"""The executor: the only holder of the database driver (ADR 0002, section 9, item 1).

Importing this package opens the registry, loads the fixed list of query modules (which make
every `Query`, from literals and from the `.sql` files of the fixed list) and freezes it. After
that no `Query` can be made, and a handle runs only the registry's text for a `Query` it finds
there by identity. Everything public is named below; the `_` modules are the executor's own.
"""

from importlib import import_module as _import_module

from player_backend.db.executor._errors import (
    DatabaseError,
    ExecutorError,
    HandleClosed,
    NotAQuery,
    QuerySourceError,
    RegistryFrozen,
    RegistryNotFrozen,
)
from player_backend.db.executor._handle import Handle, Params, Row, connect
from player_backend.db.executor._pool import Pool, open_pool
from player_backend.db.executor._query import REGISTRY as _REGISTRY
from player_backend.db.executor._query import Query
from player_backend.db.executor._sources import QUERY_MODULES, SQL_DIR, SQL_FILES

__all__ = [
    "QUERY_MODULES",
    "SQL_DIR",
    "SQL_FILES",
    "DatabaseError",
    "ExecutorError",
    "Handle",
    "HandleClosed",
    "NotAQuery",
    "Params",
    "Pool",
    "Query",
    "QuerySourceError",
    "RegistryFrozen",
    "RegistryNotFrozen",
    "Row",
    "connect",
    "open_pool",
]


def _load_fixed_list() -> None:
    for name in QUERY_MODULES:
        _import_module(name)


_REGISTRY.load(_load_fixed_list)
