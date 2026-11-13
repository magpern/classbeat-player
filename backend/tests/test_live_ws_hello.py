"""The live WebSocket's `hello` and handshake, on fakes (live/ws.py; ADR 0002, sections 8 and
10; ADR 0005, sections 3 and 4).

- the first message is `hello` with the token, within 5 s and 1 KiB, valid by its schema; any
  other first message, a late one or none closes with 4401;
- the prefix gives the role: a host token makes the host, a controller token the controller in
  its slot; a rider token gets nothing in the companion part of PL8, and is not looked up;
- a controller's handshake `Origin` must be the site's, checked before its token is looked up;
  the host's is not checked;
- no token in the address and no cookie counts;
- an address over its connection limits is refused at the handshake;
- after `hello`, another `hello` is dropped and counted.
"""

from __future__ import annotations

import ipaddress
import json
from typing import Any

import pytest
from starlette.websockets import WebSocketDisconnect

from player_backend.client_policy import address_hash
from player_backend.live_limit_policy import WAITING_FOR_HELLO
from player_backend.token_issue import new_token
from tests.livehelp import SITE, WS, closed, hello, live_app, nothing, recv


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Any:
    with live_app(monkeypatch, hello_within=0.3) as running:
        yield running


def _no_lookup(live: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*_args: object) -> None:
        raise AssertionError("looked up")

    monkeypatch.setattr(live.registry, "host_session", refuse)
    monkeypatch.setattr(live.registry, "controller_seat", refuse)


@pytest.mark.parametrize("origin", [None, "https://anywhere.example", SITE])
def test_a_host_token_makes_the_host_whatever_its_origin(live: Any, origin: str | None) -> None:
    started = live.session()
    with live.connect(origin) as ws:
        ws.send_json(hello(started.host_token))
        assert recv(ws) == {"v": 1, "type": "welcome", "role": "host"}
        assert live.hub.connected(started.session_id) == (True, ())


@pytest.mark.parametrize("signed_in", [False, True])
def test_a_controller_token_makes_the_controller_in_its_slot(live: Any, signed_in: bool) -> None:
    started = live.session()
    first, second = live.controller(started), live.controller(started, signed_in)
    with live.joined(first), live.connect() as ws:
        ws.send_json(hello(second))
        assert recv(ws) == {
            "v": 1,
            "type": "welcome",
            "role": "controller",
            "slot": 2,
            "hostConnected": False,
        }
        assert live.hub.connected(started.session_id) == (False, (1, 2))


@pytest.mark.parametrize(
    "origin",
    [None, "", "null", "https://other.example", SITE + ":444", "http://player.example.test"],
)
def test_a_controller_from_another_origin_is_refused_before_any_lookup(
    live: Any, monkeypatch: pytest.MonkeyPatch, origin: str | None
) -> None:
    started = live.session()
    token = live.controller(started)
    _no_lookup(live, monkeypatch)
    with live.connect(origin) as ws:
        ws.send_json(hello(token))
        assert closed(ws) == 4401


def test_a_rider_token_gets_no_role_and_is_not_looked_up(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    live.session()
    _no_lookup(live, monkeypatch)
    with live.connect() as ws:
        ws.send_json(hello(new_token("rdr")))
        assert closed(ws) == 4401


@pytest.mark.parametrize("kind", ["hst", "ctl"])
def test_an_unknown_token_is_refused(live: Any, kind: str) -> None:
    live.session()
    with live.connect() as ws:
        ws.send_json(hello(new_token(kind)))  # pyright: ignore[reportArgumentType]
        assert closed(ws) == 4401


def test_a_token_of_another_type_is_refused(live: Any) -> None:
    for kind in ("dev", "ses", "src"):
        with live.connect() as ws:
            ws.send_json(hello(new_token(kind)))  # pyright: ignore[reportArgumentType]
            assert closed(ws) == 4401


def test_an_ended_sessions_host_token_is_refused(live: Any) -> None:
    started = live.session()
    live.registry.end(started.session_id, "host_ended")
    with live.connect(None) as ws:
        ws.send_json(hello(started.host_token))
        assert closed(ws) == 4401


@pytest.mark.parametrize(
    "first",
    [
        "not json",
        "[]",
        '{"type":"hello"}',
        json.dumps({"v": 2, "type": "hello", "token": "x"}),
        json.dumps({"v": 1, "type": "command", "token": "x"}),
    ],
)
def test_a_first_message_that_is_not_a_good_hello_closes_4401(live: Any, first: str) -> None:
    with live.connect() as ws:
        ws.send_text(first)
        assert closed(ws) == 4401


def test_a_hello_with_an_extra_field_closes_4401(live: Any) -> None:
    started = live.session()
    with live.connect(None) as ws:
        ws.send_json(hello(started.host_token) | {"slot": 1})
        assert closed(ws) == 4401


def test_a_binary_hello_closes_4401(live: Any) -> None:
    started = live.session()
    with live.connect(None) as ws:
        ws.send_bytes(json.dumps(hello(started.host_token)).encode())
        assert closed(ws) == 4401


def test_a_first_message_over_1_kib_closes_1009(live: Any) -> None:
    started = live.session()
    with live.connect(None) as ws:
        ws.send_text(json.dumps(hello(started.host_token)) + " " * 1024)
        assert closed(ws) == 1009


def test_no_hello_in_time_closes_4401(live: Any) -> None:
    with live.connect() as ws:
        assert closed(ws, seconds=3.0) == 4401


def test_a_token_in_the_address_or_a_cookie_counts_for_nothing(live: Any) -> None:
    started = live.session()
    path = WS + "?token=" + started.host_token
    with live.client.websocket_connect(
        path, headers={"cookie": "__Host-session=" + started.host_token}
    ) as ws:
        assert closed(ws, seconds=3.0) == 4401
    assert live.hub.connected(started.session_id) == (False, ())


def test_a_second_hello_is_dropped_and_counted(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as ws:
        ws.send_json(hello(started.host_token))
        nothing(ws)
        assert live.hub.dropped["not_from_role"] == 1
        assert live.hub.connected(started.session_id) == (True, ())


def test_an_address_with_100_waiting_is_refused_at_the_handshake(live: Any) -> None:
    key = address_hash(ipaddress.ip_address("203.0.113.7"))
    for _ in range(WAITING_FOR_HELLO):
        assert live.hub.gate.admit(key, live.clock())
    with pytest.raises(WebSocketDisconnect) as refused:
        with live.connect():
            pass
    assert refused.value.code == 1008
    live.hub.gate.hello_over(key)
    started = live.session()
    with live.joined(started.host_token, None):
        pass  # one place freed: the next is admitted


def test_a_connection_stops_waiting_once_its_hello_is_over(live: Any) -> None:
    started = live.session()
    key = address_hash(ipaddress.ip_address("203.0.113.7"))
    for _ in range(WAITING_FOR_HELLO + 5):
        with live.connect(None) as ws:
            ws.send_json(hello(started.host_token))
            assert recv(ws)["type"] == "welcome"
    for _ in range(WAITING_FOR_HELLO - 1):
        assert live.hub.gate.admit(key, live.clock())
