"""The host's rider operations on the WebSocket, end to end on fakes (live/rider_role.py; ADR
0007, section 3; ADR 0002, sections 8 and 10; rule 14).

- `lock`: answered `lock_state`; every join is `cannot_join` while it is on; the riders in stay,
  and so does a token that left and comes back; unlocking lets joins in again;
- `new_join_code`: answered `join_code` to the host only; from then on the old code finds
  nothing for joins and for the controller routes, and the current control code ends; riders
  and controllers in stay; the lock survives it; past 10 an hour it is dropped and counted;
- `drop_rider`: the rider gets `ended` `dropped` and 4403, its token is gone, the host gets
  `rider_left` `dropped`, and the rider can join again with the current code;
- the session's end: every rider gets `ended` and 4403.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest

from tests.livehelp import closed, command, hello, live_app, nothing, recv

JOIN = "/api/live/join"
CONTROL = "/api/live/control"
CANNOT_JOIN = (403, {"error": "cannot_join"})
LOCK = {"v": 1, "type": "lock", "locked": True}
UNLOCK = {"v": 1, "type": "lock", "locked": False}
NEW_CODE = {"v": 1, "type": "new_join_code"}


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _join(live: Any, code: str) -> tuple[int, Any]:
    answer = live.client.post(JOIN, json={"session": code, "nickname": "Sam"})
    return answer.status_code, answer.json()


def test_lock_and_unlock(live: Any) -> None:
    started = live.session()
    inside, away = live.rider(started.join_code), live.rider(started.join_code, "Alex")
    with live.joined(started.host_token, None) as host, live.riding(inside) as rider:
        assert recv(host)["type"] == "rider_joined"
        with live.riding(away):
            assert recv(host)["type"] == "rider_joined"
        assert recv(host)["type"] == "rider_left"  # `away` left: its 5 minutes run
        host.send_json(LOCK)
        assert recv(host) == {"v": 1, "type": "lock_state", "locked": True}
        assert _join(live, started.join_code) == CANNOT_JOIN
        # The rider in stays and is still sent the class; the one that left comes back.
        with live.riding(away):
            assert recv(host)["type"] == "rider_joined"
            nothing(rider)
        assert recv(host)["type"] == "rider_left"
        host.send_json(UNLOCK)
        assert recv(host) == {"v": 1, "type": "lock_state", "locked": False}
        assert _join(live, started.join_code)[0] == 200
        nothing(rider)


def test_a_new_join_code_ends_the_old_one_for_joins_and_controls(live: Any) -> None:
    started = live.session()
    old = started.join_code
    token = live.rider(old)
    phone_token = live.controller(started)
    with (
        live.joined(started.host_token, None) as host,
        live.joined(phone_token) as phone,
        live.riding(token) as rider,
    ):
        assert recv(host)["type"] == "controller_joined"
        assert recv(host)["type"] == "rider_joined"
        host.send_json({"v": 1, "type": "make_code"})
        control = recv(host)
        assert control["type"] == "control_code"
        host.send_json(LOCK)
        assert recv(host)["locked"] is True
        host.send_json(NEW_CODE)
        answer = recv(host)
        assert answer["type"] == "join_code" and answer["code"] != old
        new = str(answer["code"])
        nothing(host)  # the control code ended silently
        nothing(phone)
        nothing(rider)  # riders and controllers in stay, and are told nothing
        # The old code finds nothing: for a join, and for the controller route (with the
        # control code made before, which has ended too); the lock survives the new code.
        assert _join(live, old) == CANNOT_JOIN
        assert _join(live, new) == CANNOT_JOIN  # still locked
        for session in (old, new):
            body = {"session": session, "code": control["code"]}
            answer = live.client.post(CONTROL, json=body)
            assert (answer.status_code, answer.json()) == (403, {"error": "invalid_code"})
        host.send_json(UNLOCK)
        assert recv(host)["locked"] is False
        assert _join(live, old) == CANNOT_JOIN
        assert _join(live, new)[0] == 200
        assert live.registry.session_of_code(old) is None
        assert live.registry.session_of_code(new) == started.session_id
        # The phone and the rider in are still connected and served.
        phone.send_json(command(1))
        assert recv(host)["slot"] == 1
        assert len(live.registry.riders_in(started.session_id)) == 1


def test_new_join_codes_past_ten_an_hour_are_dropped_and_counted(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        codes: list[str] = []
        for _ in range(10):
            live.clock.now += 1.0
            host.send_json(NEW_CODE)
            codes.append(str(recv(host)["code"]))
        assert len(set(codes)) == 10
        live.clock.now += 1.0
        host.send_json(NEW_CODE)
        host.send_json(LOCK)  # the probe: the eleventh got no answer
        assert recv(host)["type"] == "lock_state"
        assert live.hub.dropped["join_code_limit"] == 1
        # Nothing changed: the tenth code is still the session's, and the earlier ones are not.
        assert [live.registry.session_of_code(c) for c in codes] == [None] * 9 + [
            started.session_id
        ]


def test_a_removed_rider_can_join_again_with_the_current_code(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        token = live.rider(started.join_code)
        with live.riding(token) as rider:
            rider_id = str(recv(host)["rider"])
            host.send_json({"v": 1, "type": "drop_rider", "rider": rider_id})
            assert recv(rider) == {"v": 1, "type": "ended", "reason": "dropped"}
            assert closed(rider) == 4403
            assert recv(host) == {
                "v": 1,
                "type": "rider_left",
                "rider": rider_id,
                "reason": "dropped",
            }
        with live.connect() as ws:
            ws.send_json(hello(token))
            assert closed(ws) == 4401
        again = live.rider(started.join_code)
        with live.riding(again):
            message = recv(host)
            assert message["type"] == "rider_joined" and message["rider"] != rider_id


def test_removing_a_rider_that_has_left_tells_the_host_nothing_more(live: Any) -> None:
    # The host was told `rider_left` `left` when it went; within its 5 minutes the host may
    # still remove it: its token is gone, and there is no second `rider_left`.
    started = live.session()
    token = live.rider(started.join_code)
    with live.joined(started.host_token, None) as host:
        with live.riding(token):
            rider_id = str(recv(host)["rider"])
        assert recv(host) == {"v": 1, "type": "rider_left", "rider": rider_id, "reason": "left"}
        host.send_json({"v": 1, "type": "drop_rider", "rider": rider_id})
        nothing(host)
        assert not live.hub.dropped
        with live.connect() as ws:
            ws.send_json(hello(token))
            assert closed(ws) == 4401


def test_the_end_reaches_every_rider(live: Any) -> None:
    started = live.session()
    tokens = [live.rider(started.join_code, name) for name in ("Sam", "Alex")]
    with (
        live.joined(started.host_token, None) as host,
        live.riding(tokens[0]) as one,
        live.riding(tokens[1]) as two,
    ):
        recv(host)
        recv(host)
        host.send_json({"v": 1, "type": "end"})
        for ws in (one, two):
            assert recv(ws) == {"v": 1, "type": "ended", "reason": "host_ended"}
            assert closed(ws) == 4403
        assert recv(host) == {"v": 1, "type": "ended", "reason": "host_ended"}
        assert closed(host) == 4403
    for token in tokens:
        with live.connect() as ws:
            ws.send_json(hello(token))
            assert closed(ws) == 4401
