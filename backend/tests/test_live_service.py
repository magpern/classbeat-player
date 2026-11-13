"""The live service's own decisions, on fakes (live/service.py; ADR 0002, section 8; ADR 0005,
section 2). The database's answers are faked here and the clock is the test's; what the real
database answers is in tests/test_live_recheck.py and tests/test_live_sessions.py.

- a re-check the database answers "active" keeps a session past the unconfirmed limit;
- a start whose events cannot be written is taken back, and no watcher hears of it;
- the re-check drops a controller only while it still holds the site session found not active;
- a watcher that raises costs no other watcher an event and no end its audit event.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import cast

import pytest

from player_backend.client_policy import ClientInfo
from player_backend.db import live
from player_backend.db.context import AccountContext
from player_backend.db.executor import DatabaseError, Pool
from player_backend.live.registry import Dropped, Ended, Registry
from player_backend.live.service import LiveService
from player_backend.live_session_policy import RECHECK_EVERY, UNCONFIRMED_LIMIT

ACCOUNT = uuid.uuid4()
DEVICE_HASH = b"d" * 32
OLD_SITE, NEW_SITE = b"o" * 32, b"n" * 32
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


def _service(clock: Clock) -> LiveService:
    # No pool is used: every database call of the service is faked by the test.
    return LiveService(Registry(), cast(Pool, object()), clock)


def _answering(answers: dict[bytes, bool]) -> Callable[[Pool, Sequence[bytes]], dict[bytes, bool]]:
    def answer(_pool: Pool, hashes: Sequence[bytes]) -> dict[bytes, bool]:
        return {h: answers[h] for h in hashes if h in answers}

    return answer


def test_a_confirmed_session_outlives_the_unconfirmed_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = Clock()
    service = _service(clock)
    monkeypatch.setattr(live, "devices_active", _answering({DEVICE_HASH: True}))
    started = service.registry.start(ACCOUNT, uuid.uuid4(), DEVICE_HASH, clock())
    assert started is not None
    service.registry.host_connected(started.session_id)
    # Every 30 seconds the database answers "active": the session runs on, well past 90 s.
    for _ in range(int(4 * UNCONFIRMED_LIMIT / RECHECK_EVERY)):
        clock.now += RECHECK_EVERY
        assert service.recheck() is True
        service.sweep()
    assert clock.now >= 4 * UNCONFIRMED_LIMIT
    assert [r.session_id for r in service.registry.running()] == [started.session_id]


def test_a_start_whose_events_fail_is_taken_back(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = Clock()
    service = _service(clock)
    seen: list[Ended | Dropped] = []
    service.registry.watch(seen.append)

    def refuse(*_args: object) -> None:
        raise DatabaseError("no", None)

    monkeypatch.setattr(live, "add_event", refuse)
    ctx = cast(AccountContext, FakeContext(ACCOUNT, uuid.uuid4()))
    with pytest.raises(DatabaseError):
        service.start(ctx, DEVICE_HASH, CLIENT)
    assert service.registry.running() == [] and seen == []
    # Nothing is held for the account: it may start three sessions as if nothing happened.
    for _ in range(3):
        assert service.registry.start(ACCOUNT, uuid.uuid4(), DEVICE_HASH, 0.0) is not None


def test_the_recheck_drops_only_the_controller_that_held_the_ended_site_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = Clock()
    service = _service(clock)
    registry = service.registry
    started = registry.start(ACCOUNT, uuid.uuid4(), DEVICE_HASH, 0.0)
    assert started is not None
    session_id = started.session_id
    assert registry.add_controller(session_id, b"a" * 32, OLD_SITE) == 1
    monkeypatch.setattr(live, "devices_active", _answering({DEVICE_HASH: True}))

    def sessions_active(_pool: Pool, hashes: Sequence[bytes]) -> dict[bytes, bool]:
        # While the re-check asks, slot 1 is freed and taken by another sign-in.
        assert registry.drop_controller(session_id, 1)
        assert registry.add_controller(session_id, b"b" * 32, NEW_SITE) == 1
        return dict.fromkeys(hashes, False)

    monkeypatch.setattr(live, "sessions_active", sessions_active)
    seen: list[Ended | Dropped] = []
    registry.watch(seen.append)
    assert service.recheck() is True
    # The one drop is the sign-in's own; the new controller's site session was never found
    # ended, so the re-check drops nothing more and the new controller stays.
    assert seen == [Dropped(session_id, 1)]
    held = registry.signed_in_controllers()
    assert [(c.slot, c.site_session_hash) for c in held] == [(1, NEW_SITE)]


def test_a_raising_watcher_costs_no_event_and_no_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = Clock()
    service = _service(clock)
    recorded: list[tuple[uuid.UUID, str]] = []

    def record_end(_pool: Pool, _hash: bytes, session_id: uuid.UUID, reason: str) -> str:
        recorded.append((session_id, reason))
        return live.RECORDED

    monkeypatch.setattr(live, "record_end", record_end)

    def broken(_event: Ended | Dropped) -> None:
        raise RuntimeError("a watcher's bug")

    seen: list[Ended | Dropped] = []
    service.registry.watch(broken)
    service.registry.watch(seen.append)
    ids: list[uuid.UUID] = []
    for _ in range(2):
        started = service.registry.start(uuid.uuid4(), uuid.uuid4(), DEVICE_HASH, 0.0)
        assert started is not None
        ids.append(started.session_id)
    assert service.end(ids[0], "host_ended")
    # Both end together by the sweep: the second watcher hears of both, both are recorded.
    clock.now = UNCONFIRMED_LIMIT
    started = service.registry.start(uuid.uuid4(), uuid.uuid4(), DEVICE_HASH, 0.0)
    assert started is not None
    service.sweep()
    assert [e.session_id for e in seen if isinstance(e, Ended)] == [
        ids[0],
        ids[1],
        started.session_id,
    ]
    assert recorded == [
        (ids[0], "host_ended"),
        (ids[1], "unconfirmed"),
        (started.session_id, "unconfirmed"),
    ]
