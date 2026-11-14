"""Why the host's `make_code` made no control code, on fakes (live/controllers.py,
live/code_role.py; ADR 0005, section 3; #407, from the #400 review).

`code_limit` counts only the requests the 30-an-hour limit refused. A `make_code` for a session
that is gone (ended on another thread before the hub heard of it) or past its lifetime (which
ends it, as the sweep would) is counted as `session_gone`, and never as `code_limit`.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest

from player_backend.live.events import Ended, MadeCode, NoControlCode
from player_backend.live.watchers import Event
from tests.livehelp import closed, live_app, nothing, recv, until

MAKE = {"v": 1, "type": "make_code"}


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


# -- the registry -------------------------------------------------------------------------


def test_a_session_that_is_gone_makes_no_code(live: Any) -> None:
    started = live.session()
    live.registry.end(started.session_id, "host_ended")
    made = live.registry.make_code(started.session_id, live.clock())
    assert made == NoControlCode("session_gone")


def test_thirty_an_hour_then_the_limit(live: Any) -> None:
    started = live.session()
    for _ in range(30):
        assert isinstance(live.registry.make_code(started.session_id, live.clock()), MadeCode)
    made = live.registry.make_code(started.session_id, live.clock())
    assert made == NoControlCode("code_limit")


def test_a_session_past_its_lifetime_ends_and_makes_no_code(live: Any) -> None:
    started = live.session()
    live.clock.now += 12 * 3600.0
    made = live.registry.make_code(started.session_id, live.clock())
    assert made == NoControlCode("session_gone")
    assert live.registry.running() == []
    assert live.ends == [(started.session_id, "lifetime")]
    # It ended once: a second ask finds no session and records nothing more.
    again = live.registry.make_code(started.session_id, live.clock())
    assert again == NoControlCode("session_gone")
    assert live.ends == [(started.session_id, "lifetime")]


# -- the host's connection ------------------------------------------------------------------


class HeldEnd:
    """The hub's event handler, holding every `Ended` back, the way a busy loop would."""

    def __init__(self, live: Any, monkeypatch: pytest.MonkeyPatch) -> None:
        self.hub = live.hub
        self.real = live.hub._guarded  # the bound handler the hub's watcher calls
        self.events: list[Ended] = []
        monkeypatch.setattr(live.hub, "_guarded", self)

    def __call__(self, event: Event) -> None:  # on the event loop
        if isinstance(event, Ended):
            self.events.append(event)
        else:
            self.real(event)

    def deliver(self) -> None:
        for event in self.events:
            self.hub._loop.call_soon_threadsafe(self.real, event)


def test_a_make_code_for_a_session_ended_elsewhere_is_not_the_limit(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        held = HeldEnd(live, monkeypatch)
        live.registry.end(started.session_id, "host_ended")  # as the re-check's thread would
        assert until(lambda: len(held.events) == 1)
        host.send_json(MAKE)  # the hub has not heard of the end yet
        nothing(host)
        assert live.hub.dropped["session_gone"] == 1
        assert live.hub.dropped["code_limit"] == 0
        held.deliver()
        assert recv(host) == {"v": 1, "type": "ended", "reason": "host_ended"}
        assert closed(host) == 4403


def test_a_make_code_past_the_lifetime_ends_the_session(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        live.clock.now += 12 * 3600.0
        host.send_json(MAKE)
        # The session ends as the sweep would end it; no `control_code` is sent.
        assert recv(host) == {"v": 1, "type": "ended", "reason": "expired"}
        assert closed(host) == 4403
    assert live.registry.running() == []
    assert live.ends == [(started.session_id, "lifetime")]
    assert live.hub.dropped["session_gone"] == 1
    assert live.hub.dropped["code_limit"] == 0


def test_over_the_limit_is_counted_as_the_limit_only(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        for n in range(30):
            live.clock.now += 1.0
            host.send_json(MAKE)
            if n:
                assert recv(host)["reason"] == "replaced"
            assert recv(host)["type"] == "control_code"
        live.clock.now += 1.0
        host.send_json(MAKE)
        nothing(host)
        assert live.hub.dropped["code_limit"] == 1
        assert live.hub.dropped["session_gone"] == 0
