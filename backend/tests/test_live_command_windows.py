"""Each controller's own budget of 2 commands a second, on fakes (live/command_relay.py; ADR 0005,
section 5; #407, from the #400 review, N1).

The budget is a slot's, counted for the token that holds the slot. A new token in the slot gets
a window of its own, also when it connects before the late drop of the token it replaced is
here; the same token connecting again keeps the window it had, so a reconnect buys nothing.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest

from tests.livehelp import closed, command, command_id, live_app, nothing, recv
from tests.test_live_ws_late_drop import DROP, HeldBack


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _spend(host: Any, phone: Any, first: int) -> None:
    """Two commands this second: both reach the host, and a third is answered `rate`."""
    for n in (first, first + 1):
        phone.send_json(command(n))
        assert recv(host)["id"] == command_id(n)
    phone.send_json(command(first + 2))
    refused = recv(phone)
    assert (refused["type"], refused["id"], refused["reason"]) == (
        "ack",
        command_id(first + 2),
        "rate",
    )


def test_a_new_holder_before_a_late_drop_has_its_own_window(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    old = live.controller(started)
    with live.joined(started.host_token, None) as host, live.joined(old) as phone:
        recv(host)  # controller_joined
        _spend(host, phone, 0)
        held = HeldBack(live, monkeypatch)
        host.send_json(DROP)
        held.wait()
        new = live.controller(started, signed_in=True)  # slot 1 again, in the same second
        with live.joined(new) as newer:
            assert recv(phone)["reason"] == "dropped" and closed(phone) == 4403
            assert recv(host)["type"] == "controller_joined"
            # Not the dropped token's spent budget: two of its own reach the host.
            for n in (10, 11):
                newer.send_json(command(n))
                forwarded = recv(host)
                assert (forwarded["id"], forwarded["slot"]) == (command_id(n), 1)
            held.deliver()
            nothing(host)
            # The late drop did not reset it either: a third this second is its own `rate`.
            newer.send_json(command(12))
            assert recv(newer)["reason"] == "rate"
            nothing(host)


def test_a_new_holder_after_the_drop_has_its_own_window(live: Any) -> None:
    started = live.session()
    old = live.controller(started)
    with live.joined(started.host_token, None) as host:
        with live.joined(old) as phone:
            recv(host)
            _spend(host, phone, 0)
            host.send_json(DROP)
            assert recv(phone)["reason"] == "dropped" and closed(phone) == 4403
            assert recv(host)["reason"] == "dropped"
        with live.joined(live.controller(started)) as newer:
            recv(host)
            _spend(host, newer, 10)


def test_the_same_token_connecting_again_keeps_its_window(live: Any) -> None:
    started = live.session()
    token = live.controller(started)
    with live.joined(started.host_token, None) as host:
        with live.joined(token) as phone:
            recv(host)
            _spend(host, phone, 0)
        assert recv(host)["reason"] == "disconnected"
        with live.joined(token) as again:
            recv(host)
            again.send_json(command(3))
            assert recv(again)["reason"] == "rate"
            nothing(host)
            live.clock.now += 1.0
            again.send_json(command(4))
            assert recv(host)["id"] == command_id(4)
