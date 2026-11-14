"""A rider token is refused by every controller route and every host operation, on fakes
(ADR 0007, section 6; ADR 0002, section 8; rule 14). The token is a real one, got from
`POST /api/live/join` for the session it is tried on.

- `POST /api/live/controller`: as the session cookie, as a bearer token, in another header:
  403 `cannot_control`, and no controller is held;
- `POST /api/live/control`: as the code or as the session: 422 `invalid_request`; with a bearer
  header and the join code: `invalid_code`;
- `POST /api/live/sessions`: as the bearer token: 401 `invalid_token`;
- every HTTP route of `routing.json` but the riders' own join, read from the table: the token
  in every header, the cookie and every field of the route's body gets no answer of the route's
  own, and changes nothing;
- the WebSocket: `hello` with it makes a rider and never the host or a controller (the registry
  finds no host session and no controller seat for it); and every message the table lets a host
  or a controller send, from the rider's connection, is dropped and reaches no one, so no host
  operation (end, make a code, drop, lock, new join code, remove, rider state) and no command
  can come from a rider.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest

from tests.livehelp import SCHEMA, SITE, closed, command, hello, live_app, nothing, recv

ROUTING = json.loads((SCHEMA / "routing.json").read_text(encoding="utf-8"))

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
        assert recv(host)["type"] == "rider_joined"  # `_rider` connected it
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


def _bodies(route: dict[str, Any], token: str, code: str) -> list[dict[str, Any] | None]:
    """The route's body with the token in each of its fields in turn (the join code in the rest),
    read from its schema; None for a route with no body."""
    if route["body"] is None:
        return [None]
    schema = json.loads((SCHEMA / route["body"]).read_text(encoding="utf-8"))
    fields = list(schema["properties"])
    return [{f: token if f == field else code for f in fields} for field in fields]


def _http_routes() -> list[dict[str, Any]]:
    """Every live HTTP route of the table but the riders' own join, the one a rider may use."""
    routes = [r for r in ROUTING["http"] if r["answer"] != "join-answer.schema.json"]
    assert len(routes) == len(ROUTING["http"]) - 1
    return routes


@pytest.mark.parametrize("route", _http_routes(), ids=lambda r: r["route"])
def test_every_controller_and_host_route_refuses_a_rider_token(
    live: Any, route: dict[str, Any]
) -> None:
    started = live.session()
    token = _rider(live, started)
    method, path = route["route"].split(" ")
    assert method == "POST"
    held = live.registry.running()
    for body in _bodies(route, token, started.join_code):
        for headers in ({"authorization": f"Bearer {token}"}, {"x-rider-token": token}, {}):
            for cookies in ({"__Host-cbp_session": token}, {}):
                live.client.cookies.clear()
                for name, value in cookies.items():
                    live.client.cookies.set(name, value)
                answer = live.client.post(path, json=body, headers=SAME_SITE | headers)
                assert answer.status_code in (401, 403, 422), (route["route"], answer.text)
                assert answer.json()["error"] in route["errors"]
    live.client.cookies.clear()
    _no_controller(live, started)
    assert live.registry.running() == held


def test_a_rider_token_makes_a_rider_never_the_host_nor_a_controller(live: Any) -> None:
    started = live.session()
    token = live.rider(started.join_code)
    assert live.registry.host_session(token, live.clock()) is None
    assert live.registry.controller_seat(token, live.clock()) is None
    with live.joined(started.host_token, None) as host:
        with live.connect(None) as ws:  # not the site's origin: refused as a rider is
            ws.send_json(hello(token))
            assert closed(ws) == 4401
        nothing(host)
        with live.riding(token):
            assert recv(host)["type"] == "rider_joined"
            assert live.hub.connected(started.session_id) == (True, ())
    assert live.registry.locked(started.session_id) is False


# Every type the table lets a host or a controller send after `hello`, one valid example each.
HOST_AND_CONTROLLER = sorted(
    {
        (m["type"], m["schema"])
        for m in ROUTING["messages"]
        if m["type"] != "hello" and {"host", "controller"} & set(m["from"])
    }
)


def _example(schema: str) -> dict[str, Any]:
    folder = SCHEMA / "examples" / schema.removesuffix(".schema.json") / "valid"
    path = sorted(folder.glob("*.json"))[0]
    text = path.read_text(encoding="utf-8").replace("<secret43>", ("Ab3-_xY9" * 6)[:43])
    return json.loads(text)


def test_no_host_or_controller_message_from_a_rider_does_anything(live: Any) -> None:
    started = live.session()
    phone_token = live.controller(started)
    other = live.rider(started.join_code, "Alex")
    assert {kind for kind, _ in HOST_AND_CONTROLLER} >= {
        "end",
        "make_code",
        "drop",
        "lock",
        "cancel_code",
    }
    with (
        live.joined(started.host_token, None) as host,
        live.joined(phone_token) as phone,
        live.riding(live.rider(started.join_code)) as rider,
        live.riding(other) as watcher,
    ):
        assert [recv(host)["type"] for _ in range(3)] == ["controller_joined"] + [
            "rider_joined"
        ] * 2
        riders = [r.rider for r in live.registry.riders_in(started.session_id)]
        for kind, schema in HOST_AND_CONTROLLER:
            message = _example(schema)
            if kind == "drop_rider":
                message = message | {"rider": riders[1]}  # the other rider, by its real id
            live.clock.now += 1.0
            rider.send_json(message)
        live.clock.now += 1.0
        phone.send_json(command(1))  # the host's probe: nothing came before it
        assert recv(host) == {**command(1), "slot": 1}
        nothing(phone)
        nothing(rider)
        nothing(watcher)
        assert live.hub.dropped["not_from_role"] == len(HOST_AND_CONTROLLER)
        assert live.hub.connected(started.session_id) == (True, (1,))
    # Nothing changed: the session runs, unlocked, with its join code and both riders' tokens.
    assert [r.session_id for r in live.registry.running()] == [started.session_id]
    assert live.registry.locked(started.session_id) is False
    assert live.registry.session_of_code(started.join_code) == started.session_id
    assert live.registry.rider_connected(other, live.clock()) is not None
