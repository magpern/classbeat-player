"""No nickname, rider id, rider token or join code in any log line or audit event, on fakes
(ADR 0002, sections 8 and 11; ADR 0007, section 6).

Every rider path is run with logging at DEBUG for every logger: joins that succeed and every
kind that is refused (unknown, earlier code, locked, full, past the session's limit, past the
address's limit, a malformed nickname), connections, leaving, the 5-minute drop, removal, the
lock, new join codes (and the one past the limit), and the session's end. No log record holds
any of those values, in its message, its arguments or any field. No audit event is written for a
rider: the only events are the session's own end (with its id and reason).
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from typing import Any

import pytest

from player_backend.code_policy import ALPHABET
from tests.livehelp import live_app

JOIN = "/api/live/join"
NICK = "Zqxjvbn"  # a nickname no fixed word of a log line could hold
ODD = "Wkpfrtz‮"


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _other(code: str) -> str:
    return ALPHABET[(ALPHABET.index(code[0]) + 1) % len(ALPHABET)] + code[1:]


def _record_text(record: logging.LogRecord) -> str:
    return " ".join([record.getMessage(), repr(record.args), repr(vars(record))])


def test_no_rider_value_in_any_log_record_or_audit_event(
    live: Any, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    started = live.session()
    secret: list[str] = [NICK, "Wkpfrtz", started.join_code, started.join_code.replace("-", "")]

    def join(code: str, nickname: str = NICK) -> Any:
        return live.client.post(JOIN, json={"session": code, "nickname": nickname})

    tokens = [join(started.join_code).json()["riderToken"] for _ in range(3)]
    tokens.append(join(started.join_code, ODD).json()["riderToken"])
    seats = [live.registry.rider_connected(t, live.clock()) for t in tokens]
    assert all(s is not None for s in seats)
    secret += tokens + [s.rider for s in seats]
    assert join(started.join_code, "\x00\x01").status_code == 422
    live.registry.rider_disconnected(started.session_id, seats[0].rider, live.clock())
    live.registry.drop_rider(started.session_id, seats[1].rider)
    live.registry.lock(started.session_id, True)
    assert join(started.join_code).status_code == 403
    live.registry.lock(started.session_id, False)
    for _ in range(10):
        made = live.registry.new_join_code(started.session_id, live.clock())
        secret += [made, made.replace("-", "")]
    assert live.registry.new_join_code(started.session_id, live.clock()) is None
    current = secret[-2]
    assert join(started.join_code).status_code == 403  # an earlier code
    for _ in range(120):
        join(current)
    assert join(current).status_code == 403  # past the session's 120
    for _ in range(60):
        join(_other(current))
    assert join(current).status_code == 429  # past the address's 60
    live.clock.now += 300.0
    live.registry.confirm([started.session_id], live.clock())
    live.hub.service.sweep()  # the 5-minute drop
    assert live.hub.service.end(started.session_id, "host_ended")

    assert caplog.records, "the paths above log something"
    for record in caplog.records:
        text = _record_text(record)
        for value in secret:
            assert value not in text, record.getMessage()
    # The audit events written after `auth_enter_device` (faked): none is about a rider; the
    # session's end is the only one, with its id and reason.
    assert live.events == []
    assert live.ends == [(started.session_id, "host_ended")]


def test_a_held_riders_repr_holds_no_nickname_or_token_hash(live: Any) -> None:
    started = live.session()
    token = live.client.post(JOIN, json={"session": started.join_code, "nickname": NICK}).json()[
        "riderToken"
    ]
    seat = live.registry.rider_connected(token, live.clock())
    assert seat is not None
    held = live.registry._sessions[started.session_id]  # pyright: ignore[reportPrivateUsage]
    for shown in (repr(held), repr(seat), repr(live.registry.riders_in(started.session_id))):
        assert NICK not in shown and token not in shown
