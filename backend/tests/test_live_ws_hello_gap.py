"""A `hello`'s lookup and its attach are one step of the event loop, on fakes (live/ws.py,
live/service.py; ADR 0002, section 8; ADR 0005, sections 3 and 6; #220).

- a controller dropped, or a session ended, by another thread right after the `hello` looked it
  up still reaches the link once attached: it is told `ended` and closed, and a dropped
  controller's command never reaches the host;
- the write of an expired session's end, handed off the loop, cannot fail the `hello` (nor a
  caller off the loop): its failure is logged by its type alone.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

import pytest
from starlette.websockets import WebSocketDisconnect

from player_backend.db import live as db_live
from player_backend.live_session_policy import HOST_AWAY_LIMIT
from tests.livehelp import closed, command, hello, live_app, recv, until


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _messages(ws: Any) -> list[dict[str, Any]]:
    """Every message `ws` gets until it is quiet for a moment or closed."""
    seen: list[dict[str, Any]] = []
    try:
        while True:
            seen.append(recv(ws, 0.5))
    except (TimeoutError, WebSocketDisconnect):
        return seen


def test_a_controller_dropped_right_after_its_lookup_is_told_and_commands_nothing(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    token = live.controller(started)
    registry = live.registry
    real = registry.controller_seat

    def then_dropped(raw: object, now: float) -> Any:
        seat = real(raw, now)
        if seat is not None:  # a re-check or the host's drop, on another thread, right now
            registry.drop_controller(seat.session_id, seat.slot)
        return seat

    monkeypatch.setattr(registry, "controller_seat", then_dropped)
    with live.joined(started.host_token, None) as host, live.connect() as phone:
        phone.send_json(hello(token))
        assert recv(phone)["type"] == "welcome"
        assert recv(phone) == {"v": 1, "type": "ended", "reason": "dropped"}
        try:
            phone.send_json(command(1))
        except WebSocketDisconnect:
            pass
        assert closed(phone) == 4403
        assert not any(m["type"] == "command" for m in _messages(host))


def test_a_session_ended_right_after_the_hosts_lookup_ends_the_host_link(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    registry = live.registry
    real = registry.host_session

    def then_ended(raw: object, now: float) -> Any:
        session_id = real(raw, now)
        if session_id is not None:  # the re-check, on another thread, right now
            registry.end(session_id, "revoked")
        return session_id

    monkeypatch.setattr(registry, "host_session", then_ended)
    with live.connect(None) as host:
        host.send_json(hello(started.host_token))
        assert recv(host)["type"] == "welcome"
        assert recv(host) == {"v": 1, "type": "ended", "reason": "revoked"}
        assert closed(host) == 4403


def _failing(monkeypatch: pytest.MonkeyPatch) -> None:
    def record_end(*_args: object) -> str:
        raise RuntimeError("not a database error")

    monkeypatch.setattr(db_live, "record_end", record_end)


def _not_recorded(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        r.getMessage()
        for r in caplog.records
        if getattr(r, "fields", {}).get("event") == "live.end_not_recorded"
    ]


def test_a_failing_write_does_not_fail_the_hello(
    live: Any, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, "player_backend.live")
    _failing(monkeypatch)
    started = live.session()
    live.clock.now += HOST_AWAY_LIMIT  # the host never connected
    with live.connect(None) as host:
        host.send_json(hello(started.host_token))
        assert closed(host) == 4401
    assert live.registry.running() == []
    assert until(lambda: _not_recorded(caplog) != [])
    assert _not_recorded(caplog) == ["live: RuntimeError"]
    # The hub goes on: a new session's host is welcomed.
    with live.joined(live.session().host_token, None):
        pass


def test_a_failing_write_does_not_fail_a_caller_off_the_loop(
    live: Any, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, "player_backend.live")
    _failing(monkeypatch)
    started = live.session()
    live.clock.now += HOST_AWAY_LIMIT
    assert live.registry.host_session(started.host_token, live.clock()) is None
    assert live.registry.running() == []
    assert _not_recorded(caplog) == ["live: RuntimeError"]
