"""A drop that reaches the hub late, on fakes (live/hub.py `_dropped`; #382, from the #372 review).

The registry tells the hub of a drop from whichever thread made it; the hub acts on it on its
event loop, later. By then the place can have gone to a new token, connected or not. The late
drop then closes only the dropped token's own connection, and never shows the new holder's
place as free: a held place with no connection is told as the replay tells it (ADR 0005, the
2026-11-14 amendment), `controller_left` `disconnected` with the holder's `via`, and a new
holder already connected (its `controller_joined` sent) is told nothing more. A late drop with
no new holder is told as before. The dropped phone is closed as a drop (`ended` `dropped`,
4403) whichever comes first, the drop or the new holder's connection (#397, from #385 N3).

The drop is held back here: the hub's event handler is wrapped so that a `Dropped` waits until
the test lets it through, the way a busy loop would hold it.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest

from player_backend.live.events import Dropped
from player_backend.live.watchers import Event
from tests.livehelp import closed, live_app, nothing, recv, until

DROP = {"v": 1, "type": "drop", "slot": 1}


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


class HeldBack:
    """The hub's event handler, holding every `Dropped` back until `deliver`."""

    def __init__(self, live: Any, monkeypatch: pytest.MonkeyPatch) -> None:
        self.hub = live.hub
        self.real = live.hub._guarded  # the bound handler the hub's watcher calls
        self.events: list[Dropped] = []
        self.holding = True
        monkeypatch.setattr(live.hub, "_guarded", self)

    def __call__(self, event: Event) -> None:  # on the event loop
        if self.holding and isinstance(event, Dropped):
            self.events.append(event)
        else:
            self.real(event)

    def wait(self) -> None:
        assert until(lambda: len(self.events) == 1), "the drop did not reach the hub"

    def deliver(self) -> None:
        """Let the held drops through, on the event loop, as the watcher would have."""
        self.holding = False
        for event in self.events:
            self.hub._loop.call_soon_threadsafe(self.real, event)


def _joined(slot: int, via: str) -> dict[str, object]:
    return {"v": 1, "type": "controller_joined", "slot": slot, "via": via}


def _left(slot: int, via: str, reason: str) -> dict[str, object]:
    return {"v": 1, "type": "controller_left", "slot": slot, "via": via, "reason": reason}


def _ended_dropped(ws: Any) -> None:
    assert recv(ws) == {"v": 1, "type": "ended", "reason": "dropped"}
    assert closed(ws) == 4403


def test_a_late_drop_leaves_the_new_holders_connection_and_place(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    old = live.controller(started)
    with live.joined(started.host_token, None) as host, live.joined(old) as phone:
        assert recv(host) == _joined(1, "code")
        held = HeldBack(live, monkeypatch)
        host.send_json(DROP)
        held.wait()
        # The place goes to a new phone, which connects before the drop reaches the hub.
        new = live.controller(started, signed_in=True)
        with live.joined(new) as newer:
            # Its token was dropped, so it is closed as a drop, not as a replaced connection.
            _ended_dropped(phone)
            assert recv(host) == _joined(1, "sign_in")
            held.deliver()
            # Nothing about the new holder's place: it is not shown free, its phone stays.
            nothing(host)
            nothing(newer)
            assert live.hub.connected(started.session_id) == (True, (1,))
            assert live.registry.places(started.session_id) == {1: "sign_in"}
            # The new holder's own drop is told as ever.
            host.send_json(DROP)
            _ended_dropped(newer)
            assert recv(host) == _left(1, "sign_in", "dropped")
            nothing(host)


def test_a_late_drop_with_neither_phone_connected_names_the_new_holders_via(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    old = live.controller(started)
    with live.joined(started.host_token, None) as host:
        assert live.replays[-1][0] == _left(1, "code", "disconnected")
        held = HeldBack(live, monkeypatch)
        host.send_json(DROP)
        held.wait()
        new = live.controller(started, signed_in=True)  # slot 1 again, not connected yet
        held.deliver()
        # Held, not connected, by the new token: its `via`, not the dropped one's.
        assert recv(host) == _left(1, "sign_in", "disconnected")
        nothing(host)
        assert live.registry.places(started.session_id) == {1: "sign_in"}
        assert live.registry.controller_seat(old, live.clock()) is None
        with live.joined(new):
            assert recv(host) == _joined(1, "sign_in")


def test_a_late_drop_closes_the_dropped_phone_but_not_the_new_holders_place(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    old = live.controller(started)
    with live.joined(started.host_token, None) as host, live.joined(old) as phone:
        assert recv(host) == _joined(1, "code")
        held = HeldBack(live, monkeypatch)
        host.send_json(DROP)
        held.wait()
        live.controller(started, signed_in=True)  # slot 1 again, not connected
        held.deliver()
        _ended_dropped(phone)  # the dropped token's own connection goes
        # The phone the host saw join is gone; the place is held, not free, and not connected.
        assert recv(host) == _left(1, "sign_in", "disconnected")
        nothing(host)
        assert live.hub.connected(started.session_id) == (True, ())
        assert live.registry.places(started.session_id) == {1: "sign_in"}


def test_a_late_drop_with_no_new_holder_is_told_as_ever(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    old = live.controller(started)
    with live.joined(started.host_token, None) as host, live.joined(old) as phone:
        assert recv(host) == _joined(1, "code")
        held = HeldBack(live, monkeypatch)
        host.send_json(DROP)
        held.wait()
        held.deliver()
        _ended_dropped(phone)
        assert recv(host) == _left(1, "code", "dropped")
        nothing(host)
        assert live.hub.connected(started.session_id) == (True, ())
