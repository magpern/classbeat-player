"""The hub's one way of sending refuses what the allowlist does not let reach a role (live/hub.py
`_send`; ADR 0005, section 7; ADR 0002, section 8: the send function takes only the allowed
types).

Each case is handed to `_send` directly: nothing is queued on the link, and `refused` counts it.
A table over every example of the contract and every role (host, controller, rider) holds the
sender to the routing table: a rider is sent exactly the four rider-bound types. One message to
many riders is the same bytes to each (live/sender.py `send_all`).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from typing import Any, cast

import pytest

from player_backend.live.link import Link, Socket
from player_backend.live_route_policy import Role
from tests.livehelp import SCHEMA, command, command_id, companion_state, live_app

ACK = {"v": 1, "type": "ack", "id": command_id(1), "result": "applied", "reason": None}
HOST_STATUS = {"v": 1, "type": "host_status", "connected": True}
JOINED = {"v": 1, "type": "controller_joined", "slot": 1, "via": "code"}


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _link(role: Role) -> Link:
    slot = 1 if role == "controller" else None
    return Link(cast(Socket, object()), role, uuid.uuid4(), slot, "code" if slot else None)


def _queued(link: Link) -> int:
    return len(link._outbox)  # pyright: ignore[reportPrivateUsage]


@pytest.mark.parametrize(
    ("role", "message", "label"),
    [
        ("host", companion_state(), "unrouted"),
        ("host", ACK, "unrouted"),
        ("host", HOST_STATUS, "unrouted"),
        ("controller", JOINED, "unrouted"),
        ("controller", {**command(1), "slot": 1}, "unrouted"),
        ("controller", {"v": 1, "type": "control_code", "code": "ABCD"}, "unrouted"),
        ("host", {"v": 1, "type": "rider_state"}, "unrouted"),
        ("controller", {"v": 1, "type": "hello", "token": "x"}, "unrouted"),
        ("controller", {"v": 1}, "unrouted"),
        ("controller", HOST_STATUS | {"connected": "yes"}, "host_status"),
        ("host", JOINED | {"slot": 3}, "controller_joined"),
        ("controller", companion_state() | {"riders": 12}, "companion_state"),
    ],
)
def test_a_message_the_allowlist_does_not_let_reach_the_role_is_not_sent(
    live: Any, role: Role, message: dict[str, Any], label: str
) -> None:
    link = _link(role)
    live.hub._send(link, message)  # pyright: ignore[reportPrivateUsage]
    assert _queued(link) == 0
    assert live.hub.refused == {label: 1}


@pytest.mark.parametrize(
    ("role", "message"),
    [
        ("controller", companion_state()),
        ("controller", ACK),
        ("controller", HOST_STATUS),
        ("host", JOINED),
        ("host", {**command(1), "slot": 1}),
    ],
)
def test_what_the_allowlist_lets_reach_the_role_is_queued(
    live: Any, role: Role, message: dict[str, Any]
) -> None:
    link = _link(role)
    live.hub._send(link, message)  # pyright: ignore[reportPrivateUsage]
    assert _queued(link) == 1
    assert not live.hub.refused


def _routed_examples() -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Every routing entry with each valid example of its schema."""
    routing = json.loads((SCHEMA / "routing.json").read_text(encoding="utf-8"))
    out: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for entry in routing["messages"]:
        folder = SCHEMA / "examples" / entry["schema"].removesuffix(".schema.json") / "valid"
        paths = sorted(folder.glob("*.json"))
        assert paths, entry["schema"]
        for path in paths:
            text = path.read_text(encoding="utf-8").replace("<secret43>", ("Ab3-_xY9" * 6)[:43])
            out.append((entry, json.loads(text)))
    return out


def test_each_role_is_sent_exactly_what_the_table_routes_to_it(live: Any) -> None:
    # A table over every message of the contract and every role: a message is queued for a
    # connection exactly when its routing entry names that role as a receiver.
    received: dict[Role, set[str]] = {"host": set(), "controller": set(), "rider": set()}
    for entry, message in _routed_examples():
        for role, got in received.items():
            link = _link(role)
            live.hub._send(link, message)  # pyright: ignore[reportPrivateUsage]
            assert _queued(link) == (1 if role in entry["to"] else 0), (entry["schema"], role)
            if _queued(link):
                got.add(f"{message['type']} {entry['schema']}")
    assert received["rider"] == {
        "welcome welcome-rider.schema.json",
        "host_status host-status.schema.json",
        "rider_state rider-state.schema.json",
        "ended ended.schema.json",
    }


def test_one_message_to_many_riders_is_the_same_bytes(live: Any) -> None:
    riders = [_link("rider") for _ in range(3)]
    path = SCHEMA / "examples" / "rider-state" / "valid" / "running-three-coming.json"
    live.hub.sender.send_all(riders, json.loads(path.read_text(encoding="utf-8")))
    texts = [r._outbox[0] for r in riders]  # pyright: ignore[reportPrivateUsage]
    assert len(set(texts)) == 1 and all(_queued(r) == 1 for r in riders)
    # One that may not reach a rider reaches none of them, and is counted once.
    live.hub.sender.send_all(riders, companion_state())
    assert all(_queued(r) == 1 for r in riders)
    assert live.hub.refused == {"unrouted": 1}
