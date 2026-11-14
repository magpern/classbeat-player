"""The hub's handlers keyed by the routed message type (live/hub.py; ADR 0005, section 7).

Each handler is a method named `_on_<type>`, and the table's keys come from those names, never
from string literals. The keys must be exactly the types the routing table lets a connection send
after `hello` (`acted_on`). If a routed type has no handler, or a handler names no routed type,
the hub fails at start. Each type is listed once, so a handler for a type that two roles may send
must check `link.role` itself (no type has two senders today).
"""

from __future__ import annotations

from collections.abc import Callable

from player_backend.live.link import Link
from player_backend.live.schemas import routes
from player_backend.live_route_policy import acted_on
from player_backend.live_wire_policy import Message

type Handler = Callable[[Link, Message], None]


def by_type(*handlers: Handler) -> dict[str, Handler]:
    table = {h.__name__.removeprefix("_on_"): h for h in handlers}
    if len(table) != len(handlers) or set(table) != set(acted_on(routes())):
        raise RuntimeError("the live hub's handlers are not the routing table's types")
    return table
