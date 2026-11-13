"""One live session's traffic never reaches another's, and a controller's place is its token's
alone (live/hub.py, live/registry.py; ADR 0005, sections 3, 5 and 7; ADR 0002, section 8).

- `companion_state`, `host_status`, `controller_joined` and `controller_left` stay in their
  session; a `command` and the `command_result` answering it do too, even with the same id and
  slot in both;
- a dropped controller's token is refused once its slot is given to a new controller, and the
  new one stays connected;
- a controller's or host's `hello` to a session past its lifetime is refused, and the session
  ends with one `live.session_ended` recorded;
- answers to commands sent before the host left reach no one once it is back.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import ExitStack
from typing import Any

import pytest

from player_backend.live_session_policy import HOST_AWAY_LIMIT
from player_backend.token_policy import token_hash
from tests.livehelp import (
    closed,
    command,
    command_id,
    companion_state,
    hello,
    live_app,
    nothing,
    recv,
    result,
)


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def test_nothing_crosses_from_one_session_to_another(live: Any) -> None:
    first, second = live.session(), live.session()
    with ExitStack() as stack:
        host_a = stack.enter_context(live.joined(first.host_token, None))
        phone_a = stack.enter_context(live.joined(live.controller(first)))
        assert recv(host_a) == {"v": 1, "type": "controller_joined", "slot": 1, "via": "code"}
        b_stack = stack.enter_context(ExitStack())
        phone_b = b_stack.enter_context(live.joined(live.controller(second)))
        host_b = b_stack.enter_context(live.joined(second.host_token, None))
        assert recv(host_b)["type"] == "controller_joined"
        assert recv(phone_b) == {"v": 1, "type": "host_status", "connected": True}
        nothing(host_a)  # the other session's phone joined: not a word here
        nothing(phone_a)  # the other session's host came in: not a word here

        state = companion_state()
        host_a.send_json(state)
        assert recv(phone_a) == state
        nothing(phone_b)

        phone_a.send_json(command(1))  # the same id and slot in both sessions
        phone_b.send_json(command(1))
        assert recv(host_a) == {**command(1), "slot": 1}
        assert recv(host_b) == {**command(1), "slot": 1}
        host_b.send_json(result(1, 1, "refused", "stale"))
        assert recv(phone_b)["reason"] == "stale"
        nothing(phone_a)
        host_a.send_json(result(1, 1))
        assert recv(phone_a) == {
            "v": 1,
            "type": "ack",
            "id": command_id(1),
            "result": "applied",
            "reason": None,
        }
        nothing(phone_b)

        b_stack.close()  # the other session's phone and host leave
        nothing(host_a)
        nothing(phone_a)
        assert live.hub.connected(first.session_id) == (True, (1,))
        assert live.hub.connected(second.session_id) == (False, ())


def test_a_dropped_token_stays_refused_once_its_slot_is_given_again(live: Any) -> None:
    started = live.session()
    old = live.controller(started)
    with live.joined(started.host_token, None) as host:
        with live.joined(old) as gone:
            recv(host)
            assert live.registry.drop_controller(started.session_id, 1)
            assert recv(gone)["reason"] == "dropped"
            assert closed(gone) == 4403
        recv(host)  # controller_left
        new = live.controller(started)
        with live.joined(new) as phone:
            assert recv(host) == {"v": 1, "type": "controller_joined", "slot": 1, "via": "code"}
            with live.connect() as again:
                again.send_json(hello(old))
                assert closed(again) == 4401
            nothing(phone)  # not replaced
            phone.send_json(command(1))
            assert recv(host) == {**command(1), "slot": 1}
    assert live.registry.controller_seat(old, live.clock()) is None
    held = live.registry._by_controller  # pyright: ignore[reportPrivateUsage]
    assert token_hash(old) not in held and token_hash(new) in held  # the drop left no entry


def test_a_stale_index_entry_hands_over_no_slot(live: Any) -> None:
    # Even were the index to keep a dropped token, its slot's holder is checked by its hash.
    started = live.session()
    old = live.controller(started)
    registry = live.registry
    stale = dict(registry._by_controller)  # pyright: ignore[reportPrivateUsage]
    assert registry.drop_controller(started.session_id, 1)
    new = live.controller(started)
    registry._by_controller.update(stale)  # pyright: ignore[reportPrivateUsage]
    assert registry.controller_seat(old, live.clock()) is None
    assert registry.controller_seat(new, live.clock()) is not None


def test_a_controllers_hello_to_a_session_past_its_lifetime_is_refused(live: Any) -> None:
    started = live.session()
    token = live.controller(started)
    live.clock.now += HOST_AWAY_LIMIT  # the host never connected
    with live.connect() as ws:
        ws.send_json(hello(token))
        assert closed(ws) == 4401
    assert live.registry.running() == []
    # Ended there, as the sweep would have ended it, and recorded once.
    assert live.ends == [(started.session_id, "host_away")]


def test_a_hosts_hello_to_a_session_past_its_lifetime_is_refused_and_recorded(
    live: Any,
) -> None:
    started = live.session()
    live.clock.now += HOST_AWAY_LIMIT  # the host never connected
    for _ in range(2):
        with live.connect() as ws:
            ws.send_json(hello(started.host_token))
            assert closed(ws) == 4401
    assert live.registry.running() == []
    assert live.ends == [(started.session_id, "host_away")]


def test_answers_to_commands_sent_before_the_host_left_reach_no_one(live: Any) -> None:
    started = live.session()
    with live.joined(live.controller(started)) as phone:
        with live.joined(started.host_token, None) as host:
            recv(host)
            recv(phone)  # host_status connected
            phone.send_json(command(1))
            recv(host)
        assert recv(phone) == {"v": 1, "type": "host_status", "connected": False}
        with live.joined(started.host_token, None) as back:
            recv(back)
            recv(phone)
            back.send_json(result(1, 1))
            nothing(phone)
    assert live.hub.dropped["unmatched_result"] == 1
