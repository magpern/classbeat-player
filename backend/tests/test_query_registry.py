"""`Query` and its registry (ADR 0002, section 9, item 1), without a database.

The registry opens when the executor is imported, loads the fixed list and freezes. After that
no `Query` can be made, and a `Query` gives its text to nobody but the executor.
"""

from __future__ import annotations

import copy
import pickle
from typing import Any, cast

import pytest

from player_backend.db.executor import (
    NotAQuery,
    Query,
    QuerySourceError,
    RegistryFrozen,
    RegistryNotFrozen,
)
from player_backend.db.executor._registry import Registry  # pyright: ignore[reportPrivateUsage]
from player_backend.db.queries import migrations as q

LOCK_TEXT = "pg_advisory_xact_lock"


def test_a_query_made_after_the_freeze_raises() -> None:
    with pytest.raises(RegistryFrozen):
        Query("SELECT 1")
    with pytest.raises(RegistryFrozen):
        Query.from_file("0001_tables.sql")


def test_a_query_is_made_from_text_or_a_file_of_the_fixed_list_only() -> None:
    for not_text in (b"SELECT 1", None, 1, q.LOCK):
        with pytest.raises(QuerySourceError):
            Query(cast(Any, not_text))
    for name in ("9999_other.sql", "../../../db/init/10-roles.sql", "/etc/hostname"):
        with pytest.raises(QuerySourceError):
            Query.from_file(cast(Any, name))


def test_query_is_final() -> None:
    with pytest.raises(TypeError):
        type("Mine", (Query,), {})


def test_a_query_cannot_be_copied_or_pickled() -> None:
    for duplicate in (copy.copy, copy.deepcopy, pickle.dumps):
        with pytest.raises(TypeError):
            duplicate(q.LOCK)


def test_a_query_has_no_plus_percent_or_format() -> None:
    query: Any = q.LOCK
    for build in (
        lambda: query + " WHERE true",
        lambda: " WHERE true" + query,
        lambda: query % (1,),
        lambda: "%s" % query + query,  # noqa: UP031
        lambda: f"{query}",
        lambda: format(query),
        lambda: "{}".format(query),  # noqa: UP032
        lambda: query.format(1),
        lambda: "".join([query]),
        lambda: query.encode(),
    ):
        with pytest.raises((TypeError, AttributeError)):
            build()


def test_a_query_never_gives_its_text() -> None:
    assert LOCK_TEXT not in str(q.LOCK) and LOCK_TEXT not in repr(q.LOCK)
    assert LOCK_TEXT not in ascii(q.LOCK) and LOCK_TEXT not in "%s %r" % (q.LOCK, q.LOCK)  # noqa: UP031
    with pytest.raises(TypeError):
        bytes(cast(Any, q.LOCK))
    with pytest.raises(TypeError):
        vars(q.LOCK)
    public = [name for name in dir(q.LOCK) if not name.startswith("_")]
    assert public == ["from_file"]
    assert all(not isinstance(getattr(q.LOCK, name), str | bytes) for name in public)


def test_a_query_cannot_be_changed_in_place() -> None:
    query: Any = q.LOCK
    for name in ("text", "_text", "sql", "__slots__"):
        with pytest.raises(AttributeError):
            setattr(query, name, "SELECT 2")
        with pytest.raises(AttributeError):
            object.__setattr__(query, name, "SELECT 2")


def test_every_constant_of_the_query_modules_is_a_query() -> None:
    constants = {name: value for name, value in vars(q).items() if name.isupper()}
    assert len(constants) >= 7
    assert all(type(value) is Query for value in constants.values())


def test_a_registry_takes_queries_only_while_it_loads_and_gives_text_only_once_frozen() -> None:
    registry = Registry()
    first, late = object(), object()
    with pytest.raises(RegistryFrozen):
        registry.add(first, "before the load")
    with pytest.raises(RegistryNotFrozen):
        registry.text_of(first)

    def load() -> None:
        registry.add(first, "during the load")
        with pytest.raises(RegistryNotFrozen):
            registry.text_of(first)

    registry.load(load)
    assert registry.text_of(first) == "during the load"
    with pytest.raises(RegistryFrozen):
        registry.add(late, "after the freeze")
    with pytest.raises(RegistryFrozen):
        registry.load(lambda: registry.add(late, "a second load"))
    with pytest.raises(NotAQuery):
        registry.text_of(late)


def test_a_registry_looks_up_by_identity_not_by_equality() -> None:
    class Same:
        def __eq__(self, other: object) -> bool:
            return True

        def __hash__(self) -> int:
            return 1

    registry = Registry()
    known = Same()
    registry.load(lambda: registry.add(known, "known"))
    assert registry.text_of(known) == "known"
    with pytest.raises(NotAQuery):
        registry.text_of(Same())


def test_a_failed_load_leaves_the_registry_frozen() -> None:
    registry = Registry()

    def load() -> None:
        raise ImportError("a query module failed")

    with pytest.raises(ImportError):
        registry.load(load)
    with pytest.raises(RegistryFrozen):
        registry.add(object(), "after a failed load")
