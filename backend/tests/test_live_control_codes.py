"""Control codes and `drop`, on fakes (live/controllers.py, live/hub.py, live/control_routes.py;
ADR 0002, sections 8 and 10; ADR 0005, sections 3 and 4).

- `make_code` gets `control_code` on the host's connection only; a newer code replaces the
  current one (`code_cancelled` `replaced`); 30 an hour, more are dropped and counted;
- `POST /api/live/control` with the join code and the right code gives a controller token, once
  (`code_cancelled` `used`); a code runs out after 2 minutes (`expired`); 5 wrong tries cancel it
  (`wrong_tries`, and the audit event); a right code while both places are held is 409
  `controllers_full`, neither used up nor a wrong try;
- `drop` drops the slot's phone and ends the current code, and the host is sent nothing for it;
- sessions are apart: one session's code does nothing for another, and wrong tries count
  against the session the join code names;
- join codes that name no session count for the address: past 60 a minute, 429;
- a malformed body is 422 `invalid_request` and counts nothing.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import ExitStack
from typing import Any

import httpx
import pytest

from player_backend.code_policy import ALPHABET
from player_backend.db import live as db_live
from tests.livehelp import closed, hello, live_app, nothing, recv, validator

CONTROL = "/api/live/control"


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _code(host: Any, earlier: str | None = None, live: Any = None) -> str:
    """Ask for a code on the host's connection; the code it is sent. With `live`, a second
    passes first (the host may send 10 messages a second)."""
    if live is not None:
        live.clock.now += 1.0
    host.send_json({"v": 1, "type": "make_code"})
    if earlier is not None:
        assert recv(host) == {"v": 1, "type": "code_cancelled", "reason": earlier}
    sent = recv(host)
    assert validator("control-code.schema.json").is_valid(sent), sent  # pyright: ignore[reportUnknownMemberType]
    assert sent["type"] == "control_code" and sent["expiresInMs"] == 120000
    return str(sent["code"])


def _other(code: str) -> str:
    """A well-formed code that is not `code`."""
    first = ALPHABET[(ALPHABET.index(code[0]) + 1) % len(ALPHABET)]
    return first + code[1:]


def _sweep_after(live: Any, seconds: float, started: Any) -> None:
    """Move the clock on, with the session confirmed by the re-check as it runs, and sweep."""
    live.clock.now += seconds
    live.registry.confirm([started.session_id], live.clock())
    live.hub.service.sweep()


def _try(live: Any, join: str, code: str, address: str | None = None) -> httpx.Response:
    headers = {} if address is None else {"x-forwarded-for": address}
    return live.client.post(CONTROL, json={"session": join, "code": code}, headers=headers)


def _granted(answer: httpx.Response) -> str:
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert validator("controller-answer.schema.json").is_valid(body), body  # pyright: ignore[reportUnknownMemberType]
    assert answer.headers.get("cache-control") in (None, "no-store")
    return str(body["controllerToken"])


def _refused(answer: httpx.Response, status: int, error: str) -> None:
    assert (answer.status_code, answer.json()) == (status, {"error": error}), answer.text
    assert validator("error.schema.json").is_valid(answer.json())  # pyright: ignore[reportUnknownMemberType]


def test_a_code_goes_to_the_host_only_and_works_once(live: Any) -> None:
    started = live.session()
    with ExitStack() as stack:
        host = stack.enter_context(live.joined(started.host_token, None))
        phone = stack.enter_context(live.joined(live.controller(started)))
        assert recv(host)["type"] == "controller_joined"
        code = _code(host)
        nothing(phone)  # the code is in no message a controller receives
        token = _granted(_try(live, started.join_code, code))
        assert recv(host) == {"v": 1, "type": "code_cancelled", "reason": "used"}
        _refused(_try(live, started.join_code, code), 403, "invalid_code")
        with live.connect() as second:
            second.send_json(hello(token))
            assert recv(second) == {
                "v": 1,
                "type": "welcome",
                "role": "controller",
                "slot": 2,
                "hostConnected": True,
            }
            assert recv(host) == {"v": 1, "type": "controller_joined", "slot": 2, "via": "code"}
    added = [e for e in live.events if e[0] == db_live.CONTROLLER_ADDED]
    assert added == [
        (db_live.CONTROLLER_ADDED, {"session_id": str(started.session_id), "via": "code"})
    ]


def test_a_newer_code_replaces_the_current_one(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        first = _code(host)
        second = _code(host, earlier="replaced")
        _refused(_try(live, started.join_code, first), 403, "invalid_code")
        _granted(_try(live, started.join_code, second))


def test_a_code_runs_out_after_two_minutes(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        code = _code(host)
        _sweep_after(live, 119.0, started)
        nothing(host)
        _sweep_after(live, 1.0, started)
        assert recv(host) == {"v": 1, "type": "code_cancelled", "reason": "expired"}
        _refused(_try(live, started.join_code, code), 403, "invalid_code")
        nothing(host)


def test_a_code_that_ran_out_before_the_sweep_is_refused_and_told(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        code = _code(host)
        live.clock.now += 120.0
        # The re-check has confirmed the session meanwhile: only the code has run out.
        live.registry.confirm([started.session_id], live.clock())
        _refused(_try(live, started.join_code, code), 403, "invalid_code")
        assert recv(host) == {"v": 1, "type": "code_cancelled", "reason": "expired"}


def test_five_wrong_tries_cancel_the_code(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        code = _code(host)
        for _ in range(4):
            _refused(_try(live, started.join_code, _other(code)), 403, "invalid_code")
        nothing(host)
        _refused(_try(live, started.join_code, _other(code)), 403, "invalid_code")
        assert recv(host) == {"v": 1, "type": "code_cancelled", "reason": "wrong_tries"}
        _refused(_try(live, started.join_code, code), 403, "invalid_code")
        assert live.registry.signed_in_controllers() == []
        _granted(_try(live, started.join_code, _code(host)))  # the host makes a new one
    cancelled = [e for e in live.events if e[0] == db_live.CODE_CANCELLED]
    detail = {"session_id": str(started.session_id), "reason": "wrong_tries"}
    assert cancelled == [(db_live.CODE_CANCELLED, detail)]


def test_four_wrong_tries_leave_the_code_working(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        code = _code(host)
        for _ in range(4):
            _try(live, started.join_code, _other(code))
        _granted(_try(live, started.join_code, code))


def test_at_most_two_controllers_and_a_right_code_while_full_is_kept(live: Any) -> None:
    started = live.session()
    live.controller(started)
    live.controller(started, signed_in=True)
    with live.joined(started.host_token, None) as host:
        code = _code(host)
        for _ in range(8):  # neither used up nor counted as a wrong try
            _refused(_try(live, started.join_code, code), 409, "controllers_full")
        nothing(host)
        # The re-check frees a place (a sign-in ended); the same code now works.
        assert live.registry.drop_controller(started.session_id, 2)
        _granted(_try(live, started.join_code, code))
        assert recv(host) == {"v": 1, "type": "code_cancelled", "reason": "used"}
        _refused(_try(live, started.join_code, _code(host)), 409, "controllers_full")


def test_drop_drops_the_phone_and_ends_the_code_telling_the_host_nothing(live: Any) -> None:
    started = live.session()
    with ExitStack() as stack:
        host = stack.enter_context(live.joined(started.host_token, None))
        phone = stack.enter_context(live.joined(live.controller(started)))
        assert recv(host)["type"] == "controller_joined"
        code = _code(host)
        host.send_json({"v": 1, "type": "drop", "slot": 1})
        assert recv(phone) == {"v": 1, "type": "ended", "reason": "dropped"}
        assert closed(phone) == 4403
        assert recv(host) == {"v": 1, "type": "controller_left", "slot": 1, "via": "code"}
        nothing(host)  # no `code_cancelled`: the app clears the code when it sends `drop`
        _refused(_try(live, started.join_code, code), 403, "invalid_code")
        # The freed place needs a new code.
        _granted(_try(live, started.join_code, _code(host)))


def test_a_drop_of_an_empty_place_ends_the_code_too(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        code = _code(host)
        host.send_json({"v": 1, "type": "drop", "slot": 2})
        nothing(host)
        _refused(_try(live, started.join_code, code), 403, "invalid_code")
        _sweep_after(live, 200.0, started)
        nothing(host)  # an ended code does not run out again


def test_thirty_codes_an_hour_and_the_current_one_stays(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        code = _code(host)
        for _ in range(29):
            code = _code(host, earlier="replaced", live=live)
        live.clock.now += 1.0
        host.send_json({"v": 1, "type": "make_code"})
        nothing(host)
        assert live.hub.dropped["code_limit"] == 1
        _granted(_try(live, started.join_code, code))


def test_one_sessions_code_does_nothing_for_another(live: Any) -> None:
    one, two = live.session(), live.session()
    with (
        live.joined(one.host_token, None) as host_one,
        live.joined(two.host_token, None) as host_two,
    ):
        code_one = _code(host_one)
        code_two = _code(host_two)
        assert code_one != code_two
        for _ in range(5):  # the join code names session two: the tries count against it
            _refused(_try(live, two.join_code, code_one), 403, "invalid_code")
        assert recv(host_two) == {"v": 1, "type": "code_cancelled", "reason": "wrong_tries"}
        nothing(host_one)
        _refused(_try(live, two.join_code, code_two), 403, "invalid_code")
        _granted(_try(live, one.join_code, code_one))
        assert recv(host_one)["reason"] == "used"
        nothing(host_two)
    held = {c.session_id for c in live.registry.running()}
    assert held == {one.session_id, two.session_id}


def test_the_join_code_is_never_a_control_code(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        _refused(_try(live, started.join_code, started.join_code), 403, "invalid_code")
        _code(host)
        _refused(_try(live, started.join_code, started.join_code), 403, "invalid_code")
    assert live.registry.controller_seat("cbp_ctl_" + "A" * 43, live.clock()) is None


def test_unknown_sessions_count_for_the_address(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        code = _code(host)
        unknown = _other(started.join_code)
        for _ in range(60):
            _refused(_try(live, unknown, code), 403, "invalid_code")
        answer = _try(live, started.join_code, code)
        _refused(answer, 429, "too_many_requests")
        assert answer.headers["retry-after"] == "60"
        live.clock.now += 60.0
        _granted(_try(live, started.join_code, code))


def test_a_wrong_code_for_a_session_that_exists_is_not_counted_for_the_address(
    live: Any,
) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        for _ in range(13):  # 13 codes, each cancelled by 5 wrong tries: 65 refusals
            code = _code(host, live=live)
            for _ in range(5):
                _try(live, started.join_code, _other(code))
            recv(host)
        _granted(_try(live, started.join_code, _code(host)))


@pytest.mark.parametrize(
    ("content", "content_type"),
    [
        (b'{"session":"BCDF-GHJK"}', "application/json"),
        (b'{"session":"BCDF-GHJK","code":"bcdf-ghjk"}', "application/json"),
        (b'{"session":"BCDFGHJK","code":"BCDF-GHJK"}', "application/json"),
        (b'{"session":"BCDF-GHJK","code":"BCDF-GHJK","slot":1}', "application/json"),
        (b'{"session":"BCDF-GHJK","code":"BCDF-GHJK"}', "text/plain"),
        (b'{"session":"BCDF-GHJK","code":"BCDF-GHJK","code":"BCDF-GHJK"}', "application/json"),
        (b"\xff", "application/json"),
        (b"[]", "application/json"),
        (b"", "application/json"),
    ],
)
def test_a_malformed_body_is_invalid_request_and_counts_nothing(
    live: Any, content: bytes, content_type: str
) -> None:
    for _ in range(61):
        answer = live.client.post(CONTROL, content=content, headers={"content-type": content_type})
        _refused(answer, 422, "invalid_request")
    started = live.session()
    with live.joined(started.host_token, None) as host:
        _granted(_try(live, started.join_code, _code(host)))
