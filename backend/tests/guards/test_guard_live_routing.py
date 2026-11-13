"""Rule guard: the live process routes only as `schema/live/v1/routing.json` says, and nothing
reaches a rider (ADR 0005, sections 4 and 7; ADR 0002, section 8; rule 13).

- the router's table (read from routing.json by live/schemas.py) is the contract's list below
  exactly, and routing.json's message list exactly;
- a message is taken only from a sender the table names, and `hello` never after the first;
- the server delivers only to the roles the table names, and to a rider never;
- `companion_state` and every other message a controller can receive go to controllers and the
  host only, and `control_code` to the host only.

The expected lists below are the contract's; changing one is a rule-sensitive pull request.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from player_backend.live import schemas
from player_backend.live_route_policy import (
    Party,
    Role,
    Route,
    parse_routes,
    relayed_to,
)
from player_backend.live_route_policy import inbound as _inbound
from player_backend.live_route_policy import outbound as _outbound

ROUTING = Path(__file__).resolve().parents[3] / "schema" / "live" / "v1" / "routing.json"
PARTIES: tuple[Party, ...] = ("host", "controller", "rider", "server")
ROLES: tuple[Role, ...] = ("host", "controller")

# The contract's table, written out here so that a change to routing.json fails this guard too.
EXPECTED: tuple[tuple[str, str, tuple[str, ...], tuple[str, ...]], ...] = (
    ("hello", "hello.schema.json", ("host", "controller", "rider"), ("server",)),
    ("welcome", "welcome.schema.json", ("server",), ("host", "controller")),
    ("host_status", "host-status.schema.json", ("server",), ("controller",)),
    ("controller_joined", "controller-joined.schema.json", ("server",), ("host",)),
    ("controller_left", "controller-left.schema.json", ("server",), ("host",)),
    ("make_code", "make-code.schema.json", ("host",), ("server",)),
    ("control_code", "control-code.schema.json", ("server",), ("host",)),
    ("code_cancelled", "code-cancelled.schema.json", ("server",), ("host",)),
    ("drop", "drop.schema.json", ("host",), ("server",)),
    ("companion_state", "companion-state.schema.json", ("host",), ("controller",)),
    ("command", "command.schema.json", ("controller",), ("server",)),
    ("command", "command-forwarded.schema.json", ("server",), ("host",)),
    ("command_result", "command-result.schema.json", ("host",), ("server",)),
    ("ack", "ack.schema.json", ("server",), ("controller",)),
    ("end", "end.schema.json", ("host",), ("server",)),
    ("ended", "ended.schema.json", ("server",), ("host", "controller")),
)
ROUTES = schemas.routes()


def inbound(role: Role, kind: object) -> Route | str:
    return _inbound(ROUTES, role, kind)


def outbound(kind: str, party: Party) -> Route | None:
    return _outbound(ROUTES, kind, party)


def _contract() -> list[dict[str, Any]]:
    return json.loads(ROUTING.read_text(encoding="utf-8"))["messages"]


def test_the_routers_table_is_routing_json_exactly() -> None:
    ours = [(r.type, r.schema, list(r.sender), list(r.to)) for r in ROUTES]
    theirs = [(m["type"], m["schema"], m["from"], m["to"]) for m in _contract()]
    assert ours == theirs
    assert tuple((r.type, r.schema, r.sender, r.to) for r in ROUTES) == EXPECTED


@pytest.mark.parametrize(
    "raw",
    [
        None,
        [],
        {},
        {"messages": []},
        {"messages": [1]},
        {"messages": [{"type": "x", "schema": "x.schema.json", "from": [], "to": ["host"]}]},
        {"messages": [{"type": "x", "schema": "x.schema.json", "from": ["host"], "to": "host"}]},
        {"messages": [{"type": "x", "schema": "x.schema.json", "from": ["god"], "to": ["host"]}]},
        {"messages": [{"type": 1, "schema": "x.schema.json", "from": ["host"], "to": ["host"]}]},
    ],
)
def test_a_malformed_table_is_refused(raw: object) -> None:
    with pytest.raises(ValueError):
        parse_routes(raw)


def test_each_role_may_send_exactly_what_the_contract_lets_it() -> None:
    expected: dict[Role, set[str]] = {
        "host": {"make_code", "drop", "companion_state", "command_result", "end"},
        "controller": {"command"},
    }
    kinds = {r.type for r in ROUTES}
    for role in ROLES:
        taken = {k for k in kinds if not isinstance(inbound(role, k), str)}
        assert taken == expected[role]
    assert inbound("host", "hello") == "not_from_role"  # only ever the first message
    assert inbound("controller", "hello") == "not_from_role"
    assert inbound("controller", "companion_state") == "not_from_role"
    assert inbound("host", "ack") == "not_from_role"  # the server is the one sender of ack
    for kind in ("nope", "", None, 1, "Command", "command "):
        assert inbound("host", kind) == "unknown_type"


def test_a_hosts_command_is_not_a_controllers() -> None:
    # The host's only `command` route is the forwarded one the server sends it; the host itself
    # sends none, so a `command` from the host has no route from the host.
    route = inbound("host", "command")
    assert route == "not_from_role"


def test_the_server_delivers_only_where_the_contract_says() -> None:
    contract = _contract()
    for kind in {m["type"] for m in contract}:
        for party in PARTIES:
            allowed = any(m["type"] == kind and party in m["to"] for m in contract)
            route = outbound(kind, party)
            assert (route is not None) == (allowed and party != "server"), (kind, party)


def test_nothing_reaches_a_rider() -> None:
    for route in ROUTES:
        assert "rider" not in route.to
        assert outbound(route.type, "rider") is None
    for route in ROUTES:
        assert "rider" not in relayed_to(route)


@pytest.mark.parametrize(
    ("kind", "receivers"),
    [
        ("companion_state", {"controller"}),
        ("control_code", {"host"}),
        ("code_cancelled", {"host"}),
        ("ack", {"controller"}),
        ("host_status", {"controller"}),
        ("controller_joined", {"host"}),
        ("controller_left", {"host"}),
        ("command", {"host"}),
        ("welcome", {"host", "controller"}),
        ("ended", {"host", "controller"}),
    ],
)
def test_who_receives_each_message(kind: str, receivers: set[str]) -> None:
    assert {p for p in PARTIES if outbound(kind, p) is not None} == receivers


def test_the_server_relays_only_companion_state() -> None:
    relayed = {r.type for r in ROUTES if relayed_to(r) and "server" not in r.sender}
    assert relayed == {"companion_state"}
