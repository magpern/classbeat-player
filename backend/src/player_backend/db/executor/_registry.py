"""The registry: the only place that holds the text of a statement (ADR 0002, section 9, item 1).

Closed until the executor loads its fixed list, open only during that load, frozen after it.
Statements are looked up by the identity of their `Query` object, never by a field of it, and
nothing is looked up before the freeze. No I/O here.
"""

from __future__ import annotations

from collections.abc import Callable

from player_backend.db.executor._errors import NotAQuery, RegistryFrozen, RegistryNotFrozen

_CLOSED, _OPEN, _FROZEN = "closed", "open", "frozen"


class Registry:
    def __init__(self) -> None:
        self._state = _CLOSED
        # id(query) -> (the query itself, its text). Holding the object keeps its id its own.
        self._entries: dict[int, tuple[object, str]] = {}

    def load(self, loader: Callable[[], None]) -> None:
        """Open, run `loader` (which makes every `Query`), then freeze, whatever happened."""
        if self._state != _CLOSED:
            raise RegistryFrozen("the registry is loaded once")
        self._state = _OPEN
        try:
            loader()
        finally:
            self._state = _FROZEN

    def add(self, query: object, text: str) -> None:
        if self._state != _OPEN:
            raise RegistryFrozen("a Query is made only while the executor loads its fixed list")
        self._entries[id(query)] = (query, text)

    def text_of(self, query: object) -> str:
        """The registered text of exactly this object."""
        if self._state != _FROZEN:
            raise RegistryNotFrozen("nothing runs before the registry is frozen")
        entry = self._entries.get(id(query))
        if entry is None or entry[0] is not query:
            raise NotAQuery(f"a statement is a registered Query, not this {type(query).__name__}")
        return entry[1]
