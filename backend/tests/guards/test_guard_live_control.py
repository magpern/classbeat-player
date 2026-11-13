"""Guard: nothing a join code or a rider token can do grants control of a live class (ADR 0005,
sections 3 and 7; ADR 0002, section 8; rule 14).

- the join code alone, or any token in any place (a rider's, the host's, a device's, a
  controller's), gets no controller token from either controller route: the sign-in route takes
  only the host account's sign-in, by its cookie; the code route only the session's current
  control code, which is never the join code;
- every refusal of the sign-in route is one answer, 403 `cannot_control`, never one that tells a
  missing sign-in from an ended one or a cross-site request;
- the control code is sent to the host's connection only, never to a controller's (the hub's
  allowlist; the routing guard holds the table);
- the WebSocket gives a rider token no role.

On fakes: no database is reached, because nothing here gets as far as a sign-in.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest

from player_backend.token_issue import new_token
from tests.livehelp import SITE, closed, hello, live_app, nothing, recv

CONTROLLER = "/api/live/controller"
CONTROL = "/api/live/control"


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _tokens(live: Any, started: Any) -> list[str]:
    return [
        new_token("rdr"),
        new_token("dev"),
        started.host_token,
        live.controller(started),
        started.join_code,
    ]


def _no_new_controller(live: Any, started: Any) -> None:
    assert live.registry.signed_in_controllers() == []
    # Only the one controller `_tokens` made is held: slot 2 is still free.
    assert live.registry.add_controller(started.session_id, b"x" * 32, None) == 2


@pytest.mark.parametrize(
    "headers",
    [
        {"origin": SITE},
        {"origin": SITE, "sec-fetch-site": "same-origin"},
        {"origin": "https://evil.example"},
        {"origin": SITE, "sec-fetch-site": "cross-site"},
        {},
    ],
)
def test_the_sign_in_route_gives_nothing_without_the_sign_in(
    live: Any, headers: dict[str, str]
) -> None:
    started = live.session()
    for token in _tokens(live, started):
        for sent in (
            headers | {"authorization": f"Bearer {token}"},
            headers | {"x-controller-token": token},
            headers,
        ):
            answer = live.client.post(CONTROLLER, json={"session": started.join_code}, headers=sent)
            assert (answer.status_code, answer.json()) == (403, {"error": "cannot_control"})
    _no_new_controller(live, started)


def test_the_code_route_takes_no_token_and_not_the_join_code(live: Any) -> None:
    started = live.session()
    tokens = _tokens(live, started)
    with live.joined(started.host_token, None) as host:
        for made in (False, True):
            if made:
                host.send_json({"v": 1, "type": "make_code"})
                assert recv(host)["type"] == "control_code"
            for token in tokens:
                body = {"session": started.join_code, "code": token}
                answer = live.client.post(
                    CONTROL, json=body, headers={"authorization": f"Bearer {token}"}
                )
                expected = 403 if token == started.join_code else 422
                assert answer.status_code == expected, (token[:8], answer.text)
    _no_new_controller(live, started)


def test_the_control_code_reaches_the_host_only(live: Any) -> None:
    started = live.session()
    phone_token = live.controller(started)
    with live.joined(started.host_token, None) as host, live.joined(phone_token) as phone:
        assert recv(host)["type"] == "controller_joined"
        host.send_json({"v": 1, "type": "make_code"})
        assert recv(host)["type"] == "control_code"
        nothing(phone)
        phone.send_json({"v": 1, "type": "make_code"})  # a controller cannot ask for one
        nothing(phone)
        nothing(host)
    assert live.hub.dropped["not_from_role"] == 1
    assert sum(live.hub.refused.values()) == 0


def test_a_rider_token_gets_no_role(live: Any) -> None:
    with live.connect() as ws:
        ws.send_json(hello(new_token("rdr")))
        assert closed(ws) == 4401
