"""A controller place given out only with its token, on fakes (live/controllers.py,
live/service.py; ADR 0002, section 8; #190).

- a sign-in grant whose "controller added" cannot be written is taken back: the place is free
  again and no watcher hears of a phone that never had the token;
- taking a grant back frees its place only while that grant's token still holds it;
- a session past its lifetime gives no controller, by sign-in or by code, and ends then, as
  `host_session` and `controller_seat` end it.
The failed commit of the site session's transaction is in tests/test_live_controller_routes.py.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import cast

import pytest

from player_backend.client_policy import ClientInfo
from player_backend.db import live
from player_backend.db.context import AccountContext
from player_backend.db.executor import DatabaseError, Pool
from player_backend.live.registry import Ended, Registry, Started
from player_backend.live.service import LiveService
from player_backend.live.watchers import Event
from player_backend.live_session_policy import HOST_AWAY_LIMIT, LIFETIME_LIMIT, UNCONFIRMED_LIMIT

ACCOUNT = uuid.uuid4()
DEVICE_HASH = b"d" * 32
SITE = b"s" * 32
CLIENT = ClientInfo(network=None, family="")


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


@dataclass
class FakeContext:
    account_id: uuid.UUID
    credential_id: uuid.UUID


CTX = cast(AccountContext, FakeContext(ACCOUNT, uuid.uuid4()))


def _service(clock: Clock) -> tuple[LiveService, Started, list[Event]]:
    # No pool is used: every database call of the service is faked by the test.
    service = LiveService(Registry(), cast(Pool, object()), clock)
    started = service.registry.start(ACCOUNT, uuid.uuid4(), DEVICE_HASH, clock())
    assert started is not None
    seen: list[Event] = []
    service.registry.watch(seen.append)
    return service, started, seen


def _written(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    written: list[str] = []

    def add_event(_ctx: object, event: str, *_args: object, **_detail: object) -> None:
        written.append(event)

    monkeypatch.setattr(live, "add_event", add_event)
    return written


def test_a_sign_in_whose_event_fails_is_taken_back(monkeypatch: pytest.MonkeyPatch) -> None:
    service, started, seen = _service(Clock())

    def refuse(*_args: object, **_detail: object) -> None:
        raise DatabaseError("no", None)

    monkeypatch.setattr(live, "add_event", refuse)
    with pytest.raises(DatabaseError):
        service.by_sign_in(CTX, started.join_code, SITE, CLIENT)
    assert service.registry.signed_in_controllers() == [] and seen == []
    # Both places are free: two sign-ins get slots 1 and 2.
    written = _written(monkeypatch)
    for slot in (1, 2):
        granted = service.by_sign_in(CTX, started.join_code, SITE, CLIENT)
        assert granted is not None and granted.slot == slot
    assert written == [live.CONTROLLER_ADDED] * 2


def test_a_grant_is_taken_back_only_while_its_token_holds_the_place(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, started, seen = _service(Clock())
    _written(monkeypatch)
    first = service.by_sign_in(CTX, started.join_code, SITE, CLIENT)
    assert first is not None
    registry = service.registry
    assert registry.drop_controller(started.session_id, first.slot)
    # The same sign-in asks again and gets the same place, with another token.
    second = service.by_sign_in(CTX, started.join_code, SITE, CLIENT)
    assert second is not None and second.slot == first.slot
    assert registry.release(first) is False
    assert registry.controller_seat(second.token, 0.0) is not None
    assert registry.release(second) is True
    assert registry.controller_seat(second.token, 0.0) is None
    assert registry.release(second) is False
    assert registry.signed_in_controllers() == []
    assert len(seen) == 1  # the drop only: a release tells no one


@pytest.mark.parametrize(
    ("after", "host_connected", "reason"),
    [
        (UNCONFIRMED_LIMIT, True, "unconfirmed"),
        (HOST_AWAY_LIMIT, False, "host_away"),
        (LIFETIME_LIMIT, True, "lifetime"),
    ],
)
def test_a_session_past_its_lifetime_gives_no_controller_by_sign_in(
    monkeypatch: pytest.MonkeyPatch, after: float, host_connected: bool, reason: str
) -> None:
    clock = Clock()
    service, started, seen = _service(clock)
    written = _written(monkeypatch)
    if host_connected:
        service.registry.host_connected(started.session_id)
    # The re-check confirms the session as it runs, except when that limit is the one tested.
    confirmed = reason != "unconfirmed"
    clock.now = after - 0.001
    if confirmed:
        service.registry.confirm([started.session_id], clock())
    granted = service.by_sign_in(CTX, started.join_code, SITE, CLIENT)
    assert granted is not None and service.registry.release(granted)
    clock.now = after
    if confirmed:
        service.registry.confirm([started.session_id], clock())
    assert service.by_sign_in(CTX, started.join_code, SITE, CLIENT) is None
    assert service.registry.running() == [] and service.registry.signed_in_controllers() == []
    assert [(e.session_id, e.reason) for e in seen if isinstance(e, Ended)] == [
        (started.session_id, reason)
    ]
    assert written == [live.CONTROLLER_ADDED]  # the first grant's only


def test_another_account_does_not_end_a_session_past_its_lifetime() -> None:
    clock = Clock()
    service, started, seen = _service(clock)
    clock.now = UNCONFIRMED_LIMIT
    other = uuid.uuid4()
    assert service.registry.sign_in_controller(started.session_id, other, SITE, clock()) is None
    assert seen == [] and len(service.registry.running()) == 1


def test_a_session_past_its_lifetime_gives_no_controller_by_code() -> None:
    clock = Clock()
    service, started, seen = _service(clock)
    registry = service.registry
    made = registry.make_code(started.session_id, clock())
    assert made is not None
    clock.now = UNCONFIRMED_LIMIT
    exchanged = registry.exchange(started.join_code, made.code, clock())
    assert (exchanged.granted, exchanged.refusal, exchanged.cancelled) == (None, "unknown", None)
    assert registry.running() == [] and registry.session_of_code(started.join_code) is None
    assert [(e.session_id, e.reason) for e in seen if isinstance(e, Ended)] == [
        (started.session_id, "unconfirmed")
    ]


def test_a_session_just_inside_its_lifetime_gives_a_controller_by_code() -> None:
    clock = Clock()
    service, started, seen = _service(clock)
    made = service.registry.make_code(started.session_id, clock())
    assert made is not None
    clock.now = UNCONFIRMED_LIMIT - 0.001
    exchanged = service.registry.exchange(started.join_code, made.code, clock())
    assert exchanged.granted is not None and exchanged.refusal is None
    assert not any(isinstance(e, Ended) for e in seen)
