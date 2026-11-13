"""How live connections end, on fakes (live/hub.py, live/ws.py; ADR 0002, section 8; ADR 0005,
sections 2 and 6).

- the host's `end` ends the session: every connection gets `ended` `host_ended` and 4403, and the
  end is recorded;
- the re-check, on its own thread, finding the device revoked: `ended` `revoked` and 4403 for
  all; finding a signed-in controller's site session gone: that phone gets `ended` `dropped` and
  4403, the host `controller_left`, and the session goes on;
- a controller dropped (on any thread) is closed the same way, and its token says `hello` no
  more;
- the sweep ending a session by its lifetimes: `ended` `expired`;
- a hub event that fails is logged by its type and costs no other event.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterator, Sequence
from typing import Any

import pytest

from player_backend.db import live as db_live
from player_backend.db.executor import Pool
from player_backend.live_session_policy import HOST_AWAY_LIMIT
from tests.livehelp import closed, command, hello, live_app, nothing, recv


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _on_a_thread(work: Callable[[], object]) -> None:
    thread = threading.Thread(target=work)
    thread.start()
    thread.join(5)


def _answers(monkeypatch: pytest.MonkeyPatch, devices: bool, sessions: bool) -> None:
    def devices_active(_pool: Pool, hashes: Sequence[bytes]) -> dict[bytes, bool]:
        return dict.fromkeys(hashes, devices)

    def sessions_active(_pool: Pool, hashes: Sequence[bytes]) -> dict[bytes, bool]:
        return dict.fromkeys(hashes, sessions)

    monkeypatch.setattr(db_live, "devices_active", devices_active)
    monkeypatch.setattr(db_live, "sessions_active", sessions_active)


def test_the_hosts_end_closes_every_connection_with_host_ended(live: Any) -> None:
    started = live.session()
    with (
        live.joined(started.host_token, None) as host,
        live.joined(live.controller(started)) as one,
    ):
        recv(host)
        host.send_json({"v": 1, "type": "end"})
        for ws in (host, one):
            assert recv(ws) == {"v": 1, "type": "ended", "reason": "host_ended"}
            assert closed(ws) == 4403
    assert live.ends == [(started.session_id, "host_ended")]
    assert live.registry.running() == []


def test_a_revoked_device_ends_the_session_from_the_recheck_thread(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    _answers(monkeypatch, devices=False, sessions=True)
    with (
        live.joined(started.host_token, None) as host,
        live.joined(live.controller(started)) as one,
    ):
        recv(host)
        _on_a_thread(live.hub.service.recheck)
        for ws in (host, one):
            assert recv(ws) == {"v": 1, "type": "ended", "reason": "revoked"}
            assert closed(ws) == 4403
    with live.connect(None) as again:
        again.send_json(hello(started.host_token))
        assert closed(again) == 4401


def test_a_signed_out_controller_is_dropped_and_the_session_goes_on(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    by_code, by_sign_in = live.controller(started), live.controller(started, signed_in=True)
    _answers(monkeypatch, devices=True, sessions=False)
    with (
        live.joined(started.host_token, None) as host,
        live.joined(by_code) as one,
        live.joined(by_sign_in) as two,
    ):
        recv(host)
        recv(host)
        _on_a_thread(live.hub.service.recheck)
        assert recv(two) == {"v": 1, "type": "ended", "reason": "dropped"}
        assert closed(two) == 4403
        assert recv(host) == {"v": 1, "type": "controller_left", "slot": 2, "via": "sign_in"}
        nothing(one)
        one.send_json(command(1))
        assert recv(host)["slot"] == 1
    assert live.registry.controller_seat(by_sign_in) is None
    assert live.registry.signed_in_controllers() == []


def test_a_dropped_controller_is_closed_and_its_token_is_refused(live: Any) -> None:
    started = live.session()
    token = live.controller(started)
    with live.joined(started.host_token, None) as host, live.joined(token) as phone:
        recv(host)
        _on_a_thread(lambda: live.registry.drop_controller(started.session_id, 1))
        assert recv(phone) == {"v": 1, "type": "ended", "reason": "dropped"}
        assert closed(phone) == 4403
        assert recv(host) == {"v": 1, "type": "controller_left", "slot": 1, "via": "code"}
    with live.connect() as again:
        again.send_json(hello(token))
        assert closed(again) == 4401


def test_a_session_past_its_lifetime_ends_expired(live: Any) -> None:
    started = live.session()
    with live.joined(live.controller(started)) as phone:
        live.clock.now += HOST_AWAY_LIMIT  # the host never connected
        _on_a_thread(live.hub.service.sweep)
        assert recv(phone) == {"v": 1, "type": "ended", "reason": "expired"}
        assert closed(phone) == 4403


def test_a_failing_event_is_logged_and_costs_no_other(
    live: Any, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    first, second = live.session(), live.session()
    hub = live.hub
    real = hub._ended  # pyright: ignore[reportPrivateUsage]
    calls: list[object] = []

    def flaky(event: Any) -> None:
        calls.append(event)
        if len(calls) == 1:
            raise RuntimeError("boom")
        real(event)

    monkeypatch.setattr(hub, "_ended", flaky)
    with (
        caplog.at_level(logging.ERROR, "player_backend.live"),
        live.joined(first.host_token, None) as one,
        live.joined(second.host_token, None) as two,
    ):
        _on_a_thread(lambda: live.registry.end(first.session_id, "host_ended"))
        _on_a_thread(lambda: live.registry.end(second.session_id, "host_ended"))
        assert recv(two) == {"v": 1, "type": "ended", "reason": "host_ended"}
        assert closed(two) == 4403
        nothing(one)  # its event failed: logged, and the next was still handled
    assert [r.getMessage() for r in caplog.records] == ["live: RuntimeError"]
    assert "boom" not in caplog.text
