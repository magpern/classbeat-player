"""`Query`: a statement of the fixed list, as an opaque object (ADR 0002, section 9, item 1).

A `Query` holds nothing. Its text is in the registry, under the object's identity, and only the
executor reads it. There is no `+`, `%` or `format`, `str()` and `repr()` do not give the text,
and it cannot be subclassed, copied or pickled.
"""

from __future__ import annotations

from typing import LiteralString, NoReturn, SupportsIndex, cast, final

from player_backend.db.executor._errors import QuerySourceError
from player_backend.db.executor._registry import Registry
from player_backend.db.executor._sources import SQL_DIR, SQL_FILES

REGISTRY = Registry()


@final
class Query:
    __slots__ = ()

    def __new__(cls, text: LiteralString, /) -> Query:
        """From one string literal in a query module. Raises once the registry is frozen."""
        if type(text) is not str:
            raise QuerySourceError("a Query is made from a string literal")
        query = super().__new__(cls)
        REGISTRY.add(query, text)
        return query

    @classmethod
    def from_file(cls, name: LiteralString, /) -> Query:
        """From a committed `.sql` file of the fixed list (`SQL_FILES`)."""
        if name not in SQL_FILES:
            raise QuerySourceError("not a .sql file of the fixed list")
        # A file committed in the repository, read once at load: as fixed as a literal.
        return cls(cast(LiteralString, (SQL_DIR / name).read_text(encoding="utf-8")))

    def __init_subclass__(cls, **kwargs: object) -> NoReturn:
        raise TypeError("Query is final")

    def __repr__(self) -> str:
        return "<Query>"

    def __format__(self, format_spec: str) -> NoReturn:
        raise TypeError("a Query cannot be formatted")

    def __copy__(self) -> NoReturn:
        raise TypeError("a Query cannot be copied")

    def __deepcopy__(self, memo: object) -> NoReturn:
        raise TypeError("a Query cannot be copied")

    def __reduce_ex__(self, protocol: SupportsIndex) -> NoReturn:
        raise TypeError("a Query cannot be copied or pickled")


def registered_text(statement: object) -> str:
    """The registry's own text for exactly this object, or `NotAQuery`."""
    return REGISTRY.text_of(statement)
