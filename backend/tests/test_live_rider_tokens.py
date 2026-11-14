"""A rider token is refused by every controller route and every host operation, on fakes
(ADR 0007, section 6; ADR 0002, section 8; rule 14). The token is a real one, got from
`POST /api/live/join` for the session it is tried on.

- `POST /api/live/controller`: as the session cookie, as a bearer token, in another header:
  403 `cannot_control`, and no controller is held;
- `POST /api/live/control`: as the code or as the session: 422 `invalid_request`; with a bearer
  header and the join code: `invalid_code`;
- `POST /api/live/sessions`: as the bearer token: 401 `invalid_token`;
- the WebSocket: `hello` with it becomes neither the host nor a controller (4401), and the host
  is sent nothing; the registry finds no host session and no controller seat for it, so no host
  operation (end, make a code, drop, lock, new join code, remove) has a connection to come from.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest

from tests.livehelp import SITE, closed, hello, live_app, nothing, recv

CONTROLLER = "/api/live/controller"
CONTROL = "/api/live/control"
SESSIONS = "/api/live/sessions"
SAME_SITE = {"origin": SITE, "sec-fetch-site": "same-origin"}


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _rider(live: Any, started: Any) -> str:
    answer = live.client.post(
        "/api/live/join", json={"session": started.join_code, "nickname": "Sam"}
    )
    assert answer.status_code == 200, answer.text
    token = str(answer.json()["riderToken"])
    assert live.registry.rider_connected(token, live.clock()) is not None
    return token


def _no_controller(live: Any, started: Any) -> None:
    assert live.registry.signed_in_controllers() == []
    assert live.registry.add_controller(started.session_id, b"x" * 32, None) == 1


def test_the_sign_in_route_refuses_a_rider_token(live: Any) -> None:
    started = live.session()
    token = _rider(live, started)
    body = {"session": started.join_code}
    for headers in (
        {"authorization": f"Bearer {token}"},
        {"x-rider-token": token},
        {},
    ):
        for cookies in ({"__Host-cbp_session": token}, {}):
            live.client.cookies.clear()
            for name, value in cookies.items():
                live.client.cookies.set(name, value)
            answer = live.client.post(CONTROLLER, json=body, headers=SAME_SITE | headers)
            assert (answer.status_code, answer.json()) == (403, {"error": "cannot_control"})
    live.client.cookies.clear()
    _no_controller(live, started)


def test_the_code_route_refuses_a_rider_token(live: Any) -> None:
    started = live.session()
    token = _rider(live, started)
    with live.joined(started.host_token, None) as host:
        host.send_json({"v": 1, "type": "make_code"})
        assert recv(host)["type"] == "control_code"
        for body in (
            {"session": started.join_code, "code": token},
            {"session": token, "code": started.join_code},
        ):
            answer = live.client.post(CONTROL, json=body)
            assert (answer.status_code, answer.json()) == (422, {"error": "invalid_request"})
        answer = live.client.post(
            CONTROL,
            json={"session": started.join_code, "code": started.join_code},
            headers={"authorization": f"Bearer {token}"},
        )
        assert (answer.status_code, answer.json()) == (403, {"error": "invalid_code"})
        nothing(host)
    _no_controller(live, started)


def test_the_sessions_route_refuses_a_rider_token(live: Any) -> None:
    started = live.session()
    token = _rider(live, started)
    answer = live.client.post(SESSIONS, headers={"authorization": f"Bearer {token}"})
    assert (answer.status_code, answer.json()) == (401, {"error": "invalid_token"})
    assert [r.session_id for r in live.registry.running()] == [started.session_id]


def test_a_rider_token_is_neither_the_host_nor_a_controller(live: Any) -> None:
    started = live.session()
    token = _rider(live, started)
    assert live.registry.host_session(token, live.clock()) is None
    assert live.registry.controller_seat(token, live.clock()) is None
    with live.joined(started.host_token, None) as host:
        for origin in (SITE, None):
            with live.connect(origin) as ws:
                ws.send_json(hello(token))
                assert closed(ws) == 4401
        nothing(host)
        assert live.hub.connected(started.session_id) == (True, ())
    # The rider is still in, and its session runs: the refusals changed nothing.
    assert len(live.registry.riders_in(started.session_id)) == 1
    assert live.registry.locked(started.session_id) is False
