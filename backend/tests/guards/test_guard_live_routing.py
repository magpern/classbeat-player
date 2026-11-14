"""Rule guard: the live process routes only as `schema/live/v1/routing.json` says, and nothing
reaches a rider (ADR 0005, sections 4 and 7; ADR 0007, sections 2 and 6; ADR 0002, section 8;
rule 13).

- the router's table (read from routing.json by live/schemas.py) is the contract's list below
  exactly, and routing.json's message list exactly;
- a message is taken only from a sender the table names, and `hello` never after the first;
- the server delivers only to the roles the table names: to a rider only the four types of
  ADR 0007, and in this part of PL8 to no rider at all, since no rider connection exists
  (`hello` gives a rider token no role);
- `companion_state` and every other message a controller can receive go to controllers and the
  host only, and `control_code` and `join_code` to the host only.

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
from player_backend.live_token_policy import hello_role
from player_backend.token_issue import new_token

ROUTING = Path(__file__).resolve().parents[3] / "schema" / "live" / "v1" / "routing.json"
PARTIES: tuple[Party, ...] = ("host", "controller", "rider", "server")
ROLES: tuple[Role, ...] = ("host", "controller")

# The contract's table, written out here so that a change to routing.json fails this guard too.
EXPECTED: tuple[tuple[str, str, tuple[str, ...], tuple[str, ...]], ...] = (
    ("hello", "hello.schema.json", ("host", "controller", "rider"), ("server",)),
    ("welcome", "welcome.schema.json", ("server",), ("host", "controller")),
    ("welcome", "welcome-rider.schema.json", ("server",), ("rider",)),
    ("host_status", "host-status.schema.json", ("server",), ("controller", "rider")),
    ("controller_joined", "controller-joined.schema.json", ("server",), ("host",)),
    ("controller_left", "controller-left.schema.json", ("server",), ("host",)),
    ("cancel_code", "cancel-code.schema.json", ("host",), ("server",)),
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
    ("ended", "ended.schema.json", ("server",), ("host", "controller", "rider")),
    ("rider_state", "rider-state.schema.json", ("host",), ("rider",)),
    ("rider_joined", "rider-joined.schema.json", ("server",), ("host",)),
    ("rider_left", "rider-left.schema.json", ("server",), ("host",)),
    ("drop_rider", "drop-rider.schema.json", ("host",), ("server",)),
    ("lock", "lock.schema.json", ("host",), ("server",)),
    ("lock_state", "lock-state.schema.json", ("server",), ("host",)),
    ("new_join_code", "new-join-code.schema.json", ("host",), ("server",)),
    ("join_code", "join-code.schema.json", ("server",), ("host",)),
)
# What may reach a rider at all (ADR 0007 section 2), and the host's messages that the hub does
# not act on yet (dropped and counted as `not_built_yet`): its messages about riders, and
# `cancel_code` (ADR 0005 section 10, amended 2026-11-14).
TO_RIDER = {"welcome", "host_status", "rider_state", "ended"}
HOST_NOT_BUILT_YET = {"cancel_code", "rider_state", "drop_rider", "lock", "new_join_code"}
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
        "host": {"make_code", "drop", "companion_state", "command_result", "end"}
        | HOST_NOT_BUILT_YET,
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


def test_only_adr_0007s_four_messages_reach_a_rider() -> None:
    # Exactly: what may reach a rider, from whom, and with which schema (ADR 0007 section 2).
    to_rider = {(r.type, r.schema, r.sender) for r in ROUTES if "rider" in r.to}
    assert to_rider == {
        ("welcome", "welcome-rider.schema.json", ("server",)),
        ("host_status", "host-status.schema.json", ("server",)),
        ("rider_state", "rider-state.schema.json", ("host",)),
        ("ended", "ended.schema.json", ("server",)),
    }
    assert {r.type for r in ROUTES if outbound(r.type, "rider") is not None} == TO_RIDER
    # The one message relayed to a rider is the host's `rider_state`; no controller's message
    # and no other host message is ever relayed to one.
    relayed = {r.type for r in ROUTES if "server" not in r.sender and "rider" in relayed_to(r)}
    assert relayed == {"rider_state"}
    # A rider sends nothing but `hello`, the connection's first message.
    assert {r.type for r in ROUTES if "rider" in r.sender} == {"hello"}


def test_no_rider_connection_exists_yet() -> None:
    # Not built yet, pinned exactly: a rider token gives no role at `hello`, so the four routes
    # above have no receiver, and the hub drops the host's rider messages as `not_built_yet`
    # (tests/test_live_ws_router.py).
    assert hello_role(new_token("rdr")) is None


@pytest.mark.parametrize(
    ("kind", "receivers"),
    [
        ("companion_state", {"controller"}),
        ("control_code", {"host"}),
        ("code_cancelled", {"host"}),
        ("ack", {"controller"}),
        ("host_status", {"controller", "rider"}),
        ("controller_joined", {"host"}),
        ("controller_left", {"host"}),
        ("command", {"host"}),
        ("welcome", {"host", "controller", "rider"}),
        ("ended", {"host", "controller", "rider"}),
        ("rider_state", {"rider"}),
        ("rider_joined", {"host"}),
        ("rider_left", {"host"}),
        ("lock_state", {"host"}),
        ("join_code", {"host"}),
        ("drop_rider", set[str]()),
        ("lock", set[str]()),
        ("new_join_code", set[str]()),
        ("cancel_code", set[str]()),
    ],
)
def test_who_receives_each_message(kind: str, receivers: set[str]) -> None:
    assert {p for p in PARTIES if outbound(kind, p) is not None} == receivers


def test_the_server_relays_only_companion_state_and_rider_state() -> None:
    relayed = {r.type for r in ROUTES if relayed_to(r) and "server" not in r.sender}
    assert relayed == {"companion_state", "rider_state"}
    by_type = {r.type: r for r in ROUTES if "server" not in r.sender}
    assert set(relayed_to(by_type["companion_state"])) == {"controller"}
    assert set(relayed_to(by_type["rider_state"])) == {"rider"}
