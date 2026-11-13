"""The hub's one way of sending refuses what the allowlist does not let reach a role (live/hub.py
`_send`; ADR 0005, section 7; ADR 0002, section 8: the send function takes only the allowed
types).

Each case is handed to `_send` directly: nothing is queued on the link, and `refused` counts it.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any, cast

import pytest

from player_backend.live.link import Link, Socket
from player_backend.live_route_policy import Role
from tests.livehelp import command, command_id, companion_state, live_app

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
