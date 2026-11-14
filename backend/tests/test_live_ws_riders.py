"""The WebSocket rider role, on fakes (live/rider_role.py, live/hub.py; ADR 0007, sections 2 and
6; ADR 0002, section 8; rule 13).

- a rider token's `hello` gets the rider `welcome` and the current `host_status`, and riders are
  told `host_status` as the host comes and goes;
- the host's `rider_state` reaches every rider of its session as the same bytes, and no rider
  receives anything that names another rider;
- when the host hears of a rider (`rider_joined`, `rider_left`), as a table: the first `hello`,
  a reconnect after a `left`, a connection replaced by a newer one, a token that never connects,
  the 5-minute drop, the host's removal; and what a host that connects again is told.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import ExitStack
from typing import Any

import pytest
from starlette.testclient import WebSocketTestSession

from tests.livehelp import SCHEMA, closed, frame, hello, live_app, nothing, recv

SAM, ALEX = "Sam", "Alex"


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def rider_state(seq: int = 1) -> dict[str, Any]:
    path = SCHEMA / "examples" / "rider-state" / "valid" / "running-three-coming.json"
    return json.loads(path.read_text(encoding="utf-8")) | {"seq": seq}


def joined(rider: str, nickname: str) -> dict[str, object]:
    return {"v": 1, "type": "rider_joined", "rider": rider, "nickname": nickname}


def left(rider: str, reason: str = "left") -> dict[str, object]:
    return {"v": 1, "type": "rider_left", "rider": rider, "reason": reason}


def _texts(ws: WebSocketTestSession, count: int) -> list[str]:
    """The next `count` frames' raw text: what was sent, byte for byte."""
    out: list[str] = []
    for _ in range(count):
        sent = frame(ws)
        assert sent["type"] == "websocket.send", sent
        out.append(str(sent["text"]))
    return out


def test_a_rider_is_welcomed_and_told_of_the_host(live: Any) -> None:
    started = live.session()
    token = live.rider(started.join_code)
    with live.riding(token, host_in=False) as rider:
        nothing(rider)
        with live.joined(started.host_token, None) as host:
            assert recv(rider) == {"v": 1, "type": "host_status", "connected": True}
            # The rider was in before the host's first connection: it is told on its `welcome`.
            assert recv(host)["type"] == "rider_joined"
            nothing(host)
        assert recv(rider) == {"v": 1, "type": "host_status", "connected": False}
        nothing(rider)


def test_two_riders_get_the_same_bytes_and_nothing_of_each_other(live: Any) -> None:
    started = live.session()
    with ExitStack() as stack:
        host = stack.enter_context(live.joined(started.host_token, None))
        sam = stack.enter_context(live.riding(live.rider(started.join_code, SAM)))
        sam_id = recv(host)["rider"]
        alex_token = live.rider(started.join_code, ALEX)
        alex = stack.enter_context(live.riding(alex_token))
        alex_id = recv(host)["rider"]
        for seq in (1, 2, 3):
            host.send_json(rider_state(seq))
        got_sam, got_alex = _texts(sam, 3), _texts(alex, 3)
        assert got_sam == got_alex
        assert [json.loads(t) for t in got_sam] == [rider_state(s) for s in (1, 2, 3)]
        # Alex leaves, comes back, and is removed: Sam is told none of it.
        with live.riding(alex_token):
            pass  # the earlier connection is replaced
        assert closed(alex) == 4409
        with live.riding(alex_token):
            host.send_json({"v": 1, "type": "drop_rider", "rider": alex_id})
        host.send_json(rider_state(4))
        later = _texts(sam, 1)
        assert json.loads(later[0]) == rider_state(4)
        for text in got_sam + later:
            assert ALEX not in text and alex_id not in text and sam_id not in text
        nothing(sam)


def test_the_host_hears_of_connections_not_tokens(live: Any) -> None:
    started = live.session()
    token = live.rider(started.join_code, SAM)
    never = live.rider(started.join_code, ALEX)  # never connects
    with live.joined(started.host_token, None) as host:
        # The first `hello`.
        with live.riding(token) as first:
            message = recv(host)
            rider = str(message["rider"])
            assert message == joined(rider, SAM)
            # A newer connection replaces it: the host is told nothing.
            with live.riding(token):
                assert closed(first) == 4409
                nothing(host)
            # The last connection closed: `left`.
            assert recv(host) == left(rider)
        # Back within its 5 minutes: announced again, with the same id and nickname.
        live.clock.now += 299.0
        live.registry.confirm([started.session_id], live.clock())  # the re-check's
        with live.riding(token):
            assert recv(host) == joined(rider, SAM)
        assert recv(host) == left(rider)
        # The 5-minute drop of a token that has left, and of one that never connected: nothing.
        live.clock.now += 300.0
        live.registry.confirm([started.session_id], live.clock())
        live.hub.service.sweep()
        nothing(host)
        for gone in (token, never):
            with live.connect() as ws:
                ws.send_json(hello(gone))
                assert closed(ws) == 4401
        nothing(host)


def test_the_host_removing_a_rider(live: Any) -> None:
    started = live.session()
    token = live.rider(started.join_code, SAM)
    with live.joined(started.host_token, None) as host, live.riding(token) as rider:
        rider_id = str(recv(host)["rider"])
        host.send_json({"v": 1, "type": "drop_rider", "rider": rider_id})
        assert recv(rider) == {"v": 1, "type": "ended", "reason": "dropped"}
        assert closed(rider) == 4403
        assert recv(host) == left(rider_id, "dropped")
        nothing(host)  # the connection's close tells nothing more
        # Its token is gone; removing it again is dropped and counted.
        host.send_json({"v": 1, "type": "drop_rider", "rider": rider_id})
        nothing(host)
        assert live.hub.dropped["unknown_rider"] == 1
    with live.connect() as ws:
        ws.send_json(hello(token))
        assert closed(ws) == 4401


def test_a_host_that_connects_again_is_told_the_riders_in_then_the_lock(live: Any) -> None:
    started = live.session()
    tokens = [live.rider(started.join_code, name) for name in (SAM, ALEX, "Kim")]
    with ExitStack() as stack:
        with live.joined(started.host_token, None) as host:
            riders: list[str] = []
            for token in tokens:
                stack.enter_context(live.riding(token))
                riders.append(str(recv(host)["rider"]))
            host.send_json({"v": 1, "type": "lock", "locked": True})
            assert recv(host) == {"v": 1, "type": "lock_state", "locked": True}
        live.clock.now += 1.0
        with live.joined(started.host_token, None) as again:
            # The riders connected now, in the order they joined, then the lock.
            assert [recv(again) for _ in range(4)] == [
                joined(riders[0], SAM),
                joined(riders[1], ALEX),
                joined(riders[2], "Kim"),
                {"v": 1, "type": "lock_state", "locked": True},
            ]
            nothing(again)


def test_a_replaced_host_connection_is_told_the_riders_and_the_lock(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as old:
        with live.riding(live.rider(started.join_code, SAM)) as rider:
            rider_id = str(recv(old)["rider"])
            with live.joined(started.host_token, None) as new:
                assert recv(new) == joined(rider_id, SAM)
                assert recv(new) == {"v": 1, "type": "lock_state", "locked": False}
                assert closed(old) == 4409
                nothing(rider)  # the host never left
                host_state = rider_state(7)
                new.send_json(host_state)
                assert recv(rider) == host_state
