"""Pure rules for routing on the live WebSocket: the allowlist of ADR 0005 section 4 and ADR
0002 section 8, as `schema/live/v1/routing.json` writes it. The table is read from that file
at the edge and passed in (`parse_routes`); a guard test holds it to the contract's list.

- A message is taken only from a role the table names as its sender, checked against the
  schema the table gives for that sender, and delivered only to the roles the table names.
  Anything else is dropped and counted.
- `hello` is only ever the first message; after it, one is dropped like any other stray.
- The server sends only what the table lets it send to a role, checked against that schema.
- A rider is delivered only the four types the table routes to it, and sends nothing after its
  `hello`: no route names a rider as the sender of anything else.
- The server acts on every type a connection may send after `hello` (`acted_on`): the hub keys
  its handlers by those types, so a type the table routes and the hub has no handler for fails
  when the hub is made, not when the message comes.

No I/O here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, cast

type Role = Literal["host", "controller", "rider"]
type Party = Literal["host", "controller", "rider", "server"]

HELLO: Final = "hello"


@dataclass(frozen=True)
class Route:
    type: str
    schema: str  # the file name in schema/live/v1
    sender: tuple[Party, ...]
    to: tuple[Party, ...]


PARTIES: Final[tuple[Party, ...]] = ("host", "controller", "rider", "server")


def parse_routes(raw: object) -> tuple[Route, ...]:
    """routing.json's message list as routes; anything not of that shape raises ValueError.

    Read at the edge (live/schemas.py); a guard test holds the result to the contract's list.
    """
    messages = _field(raw, "messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("routing: no message list")
    routes: list[Route] = []
    for entry in cast(list[object], messages):
        kind, schema = _field(entry, "type"), _field(entry, "schema")
        sender, to = _parties(_field(entry, "from")), _parties(_field(entry, "to"))
        if not isinstance(kind, str) or not isinstance(schema, str) or not sender or not to:
            raise ValueError("routing: a malformed entry")
        routes.append(Route(kind, schema, sender, to))
    return tuple(routes)


def _field(raw: object, name: str) -> object:
    if not isinstance(raw, dict):
        raise ValueError("routing: not an object")
    return cast(dict[str, object], raw).get(name)


def _parties(raw: object) -> tuple[Party, ...]:
    if not isinstance(raw, list):
        return ()
    found: list[Party] = []
    for item in cast(list[object], raw):
        party: Party | None = next((p for p in PARTIES if p == item), None)
        if party is None:
            raise ValueError("routing: an unknown party")
        found.append(party)
    return tuple(found)


type DropReason = Literal["not_a_message", "unknown_type", "not_from_role", "invalid"]


def inbound(
    routes: tuple[Route, ...], role: Role, kind: object
) -> Route | Literal["unknown_type", "not_from_role"]:
    """The route of a message of type `kind` sent by a connection of `role` after `hello`."""
    if not isinstance(kind, str) or all(r.type != kind for r in routes):
        return "unknown_type"
    for route in routes:
        if route.type == kind and kind != HELLO and role in route.sender:
            return route
    return "not_from_role"


def outbound(routes: tuple[Route, ...], kind: str, role: Party) -> Route | None:
    """The route by which the server may deliver a message of type `kind` to `role`, if any."""
    for route in routes:
        if route.type == kind and role in route.to and role != "server":
            return route
    return None


def relayed_to(route: Route) -> tuple[Party, ...]:
    """Whom the server passes an accepted message on to, as it is: none when it is for the
    server itself (it answers or acts on it instead)."""
    return tuple(r for r in route.to if r != "server")


def acted_on(routes: tuple[Route, ...]) -> tuple[str, ...]:
    """The types a connection may send after `hello`, each once, in the table's order: those
    the server handles (and passes on, for a relayed one)."""
    kinds = (r.type for r in routes if r.type != HELLO and any(p != "server" for p in r.sender))
    return tuple(dict.fromkeys(kinds))
