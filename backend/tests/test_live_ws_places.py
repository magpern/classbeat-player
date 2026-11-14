"""What the host is told of the two controller places, on fakes (live/hub.py, live/controllers.py,
live_place_policy.py; ADR 0005 section 10, amended 2026-11-14).

- right after every host `welcome`, in the same step, both places in slot order:
  `controller_joined` (connected), `controller_left` `disconnected` (held, not connected) or
  `controller_left` `free` (no token), and nothing else before them;
- `session_ended` (the re-check found the site session gone) and `dropped` (the host's `drop`)
  are told whether or not the phone had a connection, and `session_ended` never for a token got
  by a control code;
- a sign-out, or a phone that took a place and left, while the host is away is shown rightly by
  the replay when the host comes back.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Generator, Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import pytest

from player_backend.db import live as db_live
from player_backend.db.executor import Pool
from tests.livehelp import FREE, SITE_SESSION, hello, live_app, nothing, places, recv, validator


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _on_a_thread(work: Callable[[], object]) -> None:
    thread = threading.Thread(target=work)
    thread.start()
    thread.join(5)


def _signed_out(monkeypatch: pytest.MonkeyPatch) -> None:
    """The re-check's answers: the device is active, every site session has ended."""

    def devices_active(_pool: Pool, hashes: Sequence[bytes]) -> dict[bytes, bool]:
        return dict.fromkeys(hashes, True)

    def sessions_active(_pool: Pool, hashes: Sequence[bytes]) -> dict[bytes, bool]:
        return dict.fromkeys(hashes, False)

    monkeypatch.setattr(db_live, "devices_active", devices_active)
    monkeypatch.setattr(db_live, "sessions_active", sessions_active)


def _joined(slot: int, via: str) -> dict[str, object]:
    return {"v": 1, "type": "controller_joined", "slot": slot, "via": via}


def _left(slot: int, via: str, reason: str) -> dict[str, object]:
    return {"v": 1, "type": "controller_left", "slot": slot, "via": via, "reason": reason}


@contextmanager
def _host_in(live: Any, token: str) -> Generator[tuple[Any, list[dict[str, Any]]]]:
    """A host connected: its `welcome`, and the two messages right after it (the replay)."""
    with live.connect(None) as ws:
        ws.send_json(hello(token))
        assert recv(ws) == {"v": 1, "type": "welcome", "role": "host"}
        yield ws, places(ws)


def test_a_new_session_replays_two_free_places(live: Any) -> None:
    started = live.session()
    with _host_in(live, started.host_token) as (host, replay):
        assert replay == FREE
        for message in replay:
            assert validator("controller-left.schema.json").is_valid(message)  # pyright: ignore[reportUnknownMemberType]
        nothing(host)
    assert sum(live.hub.refused.values()) == 0


def test_the_replay_names_each_place_as_it_is(live: Any) -> None:
    started = live.session()
    by_code, by_sign_in = live.controller(started), live.controller(started, signed_in=True)
    with live.joined(by_code):
        with _host_in(live, started.host_token) as (host, replay):
            assert replay == [_joined(1, "code"), _left(2, "sign_in", "disconnected")]
            with live.joined(by_sign_in):
                assert recv(host) == _joined(2, "sign_in")
    # Slot 1 freed by the host's drop, slot 2 held but not connected.
    assert live.registry.drop_controller(started.session_id, 1, "dropped")
    with _host_in(live, started.host_token) as (host, replay):
        assert replay == [FREE[0], _left(2, "sign_in", "disconnected")]
    assert sum(live.hub.refused.values()) == 0


def test_every_welcome_replays_a_newer_host_connection_too(live: Any) -> None:
    started = live.session()
    with live.joined(live.controller(started)):
        with _host_in(live, started.host_token) as (old, first):
            with _host_in(live, started.host_token) as (new, second):
                assert first == second == [_joined(1, "code"), FREE[1]]
                # The replay comes before anything else after the `welcome`: here the riders'
                # lock state a returning host is sent.
                assert recv(new) == {"v": 1, "type": "lock_state", "locked": False}
                nothing(new)
        assert old is not new


def test_a_sign_out_while_the_host_is_away_is_shown_free_on_its_return(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    token = live.controller(started, signed_in=True)
    _signed_out(monkeypatch)
    with live.joined(token) as phone:
        with _host_in(live, started.host_token) as (_host, replay):
            assert replay == [_joined(1, "sign_in"), FREE[1]]
            assert recv(phone) == {"v": 1, "type": "host_status", "connected": True}
        assert recv(phone) == {"v": 1, "type": "host_status", "connected": False}
        _on_a_thread(live.hub.service.recheck)  # the host is away: no one to tell
        assert recv(phone) == {"v": 1, "type": "ended", "reason": "dropped"}
    with _host_in(live, started.host_token) as (host, replay):
        assert replay == FREE
        recv(host)  # lock_state: a returning host
        nothing(host)


def test_a_phone_that_came_and_went_while_the_host_was_away_is_disconnected(live: Any) -> None:
    started = live.session()
    with _host_in(live, started.host_token) as (host, _):
        host.send_json({"v": 1, "type": "make_code"})
        code = recv(host)["code"]
    answer = live.client.post(
        "/api/live/control", json={"session": started.join_code, "code": code}
    )
    assert answer.status_code == 200, answer.text
    with live.joined(answer.json()["controllerToken"]):
        pass
    with _host_in(live, started.host_token) as (host, replay):
        assert replay == [_left(1, "code", "disconnected"), FREE[1]]


def test_session_ended_is_told_without_the_phones_connection(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    live.controller(started)  # by a control code: no site session to end
    live.controller(started, signed_in=True)
    _signed_out(monkeypatch)
    with _host_in(live, started.host_token) as (host, replay):
        assert replay == [_left(1, "code", "disconnected"), _left(2, "sign_in", "disconnected")]
        _on_a_thread(live.hub.service.recheck)
        assert recv(host) == _left(2, "sign_in", "session_ended")
        nothing(host)  # never for the token got by a control code
    assert live.registry.places(started.session_id) == {1: "code"}


def test_session_ended_is_never_sent_for_a_code_token(
    live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    started = live.session()
    token = live.controller(started)
    _signed_out(monkeypatch)
    with _host_in(live, started.host_token) as (host, _), live.joined(token) as phone:
        assert recv(host) == _joined(1, "code")
        _on_a_thread(live.hub.service.recheck)
        nothing(host)
        nothing(phone)
        # A site session's end names its own hash: a code token holds none, so none matches.
        ended = "session_ended"
        assert not live.registry.drop_controller(
            started.session_id, 1, ended, site_session_hash=SITE_SESSION
        )
        nothing(host)


def test_a_drop_is_told_without_the_phones_connection(live: Any) -> None:
    started = live.session()
    live.controller(started, signed_in=True)
    with _host_in(live, started.host_token) as (host, replay):
        assert replay == [_left(1, "sign_in", "disconnected"), FREE[1]]
        host.send_json({"v": 1, "type": "drop", "slot": 1})
        assert recv(host) == _left(1, "sign_in", "dropped")
        nothing(host)
        host.send_json({"v": 1, "type": "drop", "slot": 1})  # an empty place: nothing to tell
        nothing(host)
    assert live.registry.places(started.session_id) == {}


def test_a_site_session_hash_goes_with_session_ended_only(live: Any) -> None:
    started = live.session()
    live.controller(started, signed_in=True)
    with pytest.raises(ValueError):
        live.registry.drop_controller(started.session_id, 1, "session_ended")
    with pytest.raises(ValueError):
        live.registry.drop_controller(
            started.session_id, 1, "dropped", site_session_hash=SITE_SESSION
        )
    assert live.registry.places(started.session_id) == {1: "sign_in"}
