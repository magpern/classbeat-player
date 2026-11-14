"""The host's session operations for riders, on fakes (live/riders.py; ADR 0007, section 3): the
lock, a new join code and removing a rider. The WebSocket's rider role calls them; here they are
called on the registry, with the join and control routes and the host's connection as they are.

- lock: every join is `cannot_join`; riders in stay, and so does a token that left and comes
  back within its 5 minutes; unlocking lets joins in; a session starts unlocked; the lock does
  not touch the controller routes and survives a new join code;
- new join code: the earlier code finds nothing, for joins and the controller routes; the
  current control code ends and the host is sent nothing for it; riders and controllers in stay;
  10 a session an hour, then ignored and counted, and nothing changes;
- remove: the rider's token is dropped at once; scanning again works unless the session is
  locked or the code is new.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from player_backend.code_policy import normalise_code
from tests.livehelp import live_app, nothing, recv

JOIN = "/api/live/join"
CONTROL = "/api/live/control"


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _join(live: Any, code: str, nickname: str = "Sam") -> httpx.Response:
    return live.client.post(JOIN, json={"session": code, "nickname": nickname})


def _token(live: Any, code: str, nickname: str = "Sam") -> str:
    answer = _join(live, code, nickname)
    assert answer.status_code == 200, answer.text
    return str(answer.json()["riderToken"])


def _cannot_join(answer: httpx.Response) -> None:
    assert (answer.status_code, answer.json()) == (403, {"error": "cannot_join"}), answer.text


def _seat(live: Any, token: str) -> Any:
    seat = live.registry.rider_connected(token, live.clock())
    assert seat is not None
    return seat


def _control_code(host: Any) -> str:
    host.send_json({"v": 1, "type": "make_code"})
    sent = recv(host)
    assert sent["type"] == "control_code"
    return str(sent["code"])


def _exchange(live: Any, join: str, code: str) -> httpx.Response:
    return live.client.post(CONTROL, json={"session": join, "code": code})


# -- lock ---------------------------------------------------------------------------------


def test_a_session_starts_unlocked_and_a_lock_refuses_every_join(live: Any) -> None:
    started = live.session()
    assert live.registry.locked(started.session_id) is False
    assert live.registry.lock(started.session_id, True) is True
    assert live.registry.locked(started.session_id) is True
    _cannot_join(_join(live, started.join_code))
    assert live.registry.lock(started.session_id, False) is False
    _token(live, started.join_code)


def test_riders_in_stay_locked_and_one_that_left_comes_back(live: Any) -> None:
    started = live.session()
    staying, leaving = _token(live, started.join_code, "A"), _token(live, started.join_code, "B")
    first, second = _seat(live, staying), _seat(live, leaving)
    live.registry.rider_disconnected(started.session_id, second.rider, live.clock())
    live.registry.lock(started.session_id, True)
    assert [r.rider for r in live.registry.riders_in(started.session_id)] == [first.rider]
    live.clock.now += 299.0
    live.registry.confirm([started.session_id], live.clock())
    live.hub.service.sweep()
    back = _seat(live, leaving)
    assert (back.rider, back.announced) == (second.rider, True)
    assert [r.nickname for r in live.registry.riders_in(started.session_id)] == ["A", "B"]


def test_the_lock_does_not_touch_the_controller_routes(live: Any) -> None:
    started = live.session()
    live.registry.lock(started.session_id, True)
    with live.joined(started.host_token, None) as host:
        code = _control_code(host)
        assert _exchange(live, started.join_code, code).status_code == 200


def test_the_lock_of_a_session_that_is_gone_is_none(live: Any) -> None:
    started = live.session()
    live.registry.end(started.session_id, "host_ended")
    assert live.registry.lock(started.session_id, True) is None
    assert live.registry.locked(started.session_id) is None
    assert live.registry.new_join_code(started.session_id, live.clock()) is None
    assert live.registry.drop_rider(started.session_id, "AAAAAAAAAAA") is False


# -- new join code ------------------------------------------------------------------------


def test_after_a_new_join_code_the_earlier_one_finds_nothing(live: Any) -> None:
    started = live.session()
    with live.joined(started.host_token, None) as host:
        control = _control_code(host)
        new = live.registry.new_join_code(started.session_id, live.clock())
        assert new is not None and new != started.join_code
        assert normalise_code(new) is not None and len(new) == 9
        # The joins and the controller routes (the sign-in route looks the code up here).
        _cannot_join(_join(live, started.join_code))
        assert live.registry.session_of_code(started.join_code) is None
        assert live.registry.session_of_code(new) == started.session_id
        old = _exchange(live, started.join_code, control)
        assert (old.status_code, old.json()) == (403, {"error": "invalid_code"})
        _token(live, new)
        # The current control code ended with it, and the host was sent nothing for that.
        nothing(host)
        ended = _exchange(live, new, control)
        assert (ended.status_code, ended.json()) == (403, {"error": "invalid_code"})
        nothing(host)  # a try of a code that is gone cancels nothing


def test_riders_and_controllers_in_stay_after_a_new_join_code(live: Any) -> None:
    started = live.session()
    controller = live.controller(started)
    token = _token(live, started.join_code)
    seat = _seat(live, token)
    left = _seat(live, _token(live, started.join_code, "Lee"))
    live.registry.rider_disconnected(started.session_id, left.rider, live.clock())
    live.registry.lock(started.session_id, True)
    assert live.registry.new_join_code(started.session_id, live.clock()) is not None
    assert live.registry.controller_seat(controller, live.clock()) is not None
    assert [r.rider for r in live.registry.riders_in(started.session_id)] == [seat.rider]
    assert _seat(live, token).rider == seat.rider
    # The lock survives the new code.
    assert live.registry.locked(started.session_id) is True


def test_ten_new_join_codes_an_hour_then_ignored_and_counted(live: Any) -> None:
    started = live.session()
    codes = [live.registry.new_join_code(started.session_id, live.clock()) for _ in range(10)]
    assert None not in codes and len(set(codes)) == 10
    assert live.registry.new_join_code(started.session_id, live.clock()) is None
    assert live.registry.ignored["join_code_limit"] == 1
    # Ignored: the current code still names the session.
    assert live.registry.session_of_code(codes[-1]) == started.session_id
    _token(live, str(codes[-1]))
    live.clock.now += 3600.0
    live.registry.confirm([started.session_id], live.clock())
    live.registry.host_connected(started.session_id)
    assert live.registry.new_join_code(started.session_id, live.clock()) is not None


def test_one_sessions_new_join_code_leaves_the_others(live: Any) -> None:
    one, other = live.session(), live.session()
    live.registry.new_join_code(one.session_id, live.clock())
    assert live.registry.session_of_code(other.join_code) == other.session_id
    _token(live, other.join_code)


# -- remove ---------------------------------------------------------------------------------


def test_a_removed_riders_token_is_dropped(live: Any) -> None:
    started = live.session()
    token = _token(live, started.join_code)
    seat = _seat(live, token)
    keep = _seat(live, _token(live, started.join_code, "Lee"))
    assert live.registry.drop_rider(started.session_id, seat.rider) is True
    assert live.registry.rider_connected(token, live.clock()) is None
    assert [r.rider for r in live.registry.riders_in(started.session_id)] == [keep.rider]
    assert live.registry.drop_rider(started.session_id, seat.rider) is False
    # Its connection's close tells nothing more.
    assert not live.registry.rider_disconnected(started.session_id, seat.rider, live.clock())


def test_a_removed_rider_scans_again_unless_locked_or_the_code_is_new(live: Any) -> None:
    started = live.session()
    first = _seat(live, _token(live, started.join_code))
    live.registry.drop_rider(started.session_id, first.rider)
    again = _seat(live, _token(live, started.join_code))
    assert again.rider != first.rider
    live.registry.drop_rider(started.session_id, again.rider)
    live.registry.lock(started.session_id, True)
    _cannot_join(_join(live, started.join_code))
    live.registry.lock(started.session_id, False)
    live.registry.new_join_code(started.session_id, live.clock())
    _cannot_join(_join(live, started.join_code))


def test_a_rider_of_one_session_is_not_removed_by_another(live: Any) -> None:
    one, other = live.session(), live.session()
    seat = _seat(live, _token(live, one.join_code))
    assert live.registry.drop_rider(other.session_id, seat.rider) is False
    assert [r.rider for r in live.registry.riders_in(one.session_id)] == [seat.rider]


def test_a_session_that_ends_drops_its_riders_tokens(live: Any) -> None:
    started = live.session()
    token = _token(live, started.join_code)
    _seat(live, token)
    live.registry.end(started.session_id, "host_ended")
    assert live.registry.rider_connected(token, live.clock()) is None
    assert live.registry._by_rider == {}  # pyright: ignore[reportPrivateUsage]
