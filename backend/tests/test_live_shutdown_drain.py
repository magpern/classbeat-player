"""At shutdown the app waits, for a bounded time, for the live sessions' audit writes still
running off the event loop before it closes the pool, on fakes (app.py, `LiveService.drain`;
ADR 0002, section 8; #225 N4, #227).

- an end a `hello` handed off the loop, still being written when the server stops, is written
  before the pool closes;
- a write that does not finish within the bound does not hold the shutdown: the pool is closed
  once the bound has passed.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import cast

import pytest
from starlette.testclient import TestClient

from player_backend import app as app_module
from player_backend.app import create_app
from player_backend.db import live as db_live
from player_backend.db.executor import Pool
from player_backend.live.service import LiveService
from player_backend.live_session_policy import HOST_AWAY_LIMIT
from player_backend.settings import Settings
from tests.livehelp import SITE, WS, closed, hello, until


class FakePool:
    """Stands for the executor's pool: it notes when it is closed."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


@dataclass
class Writes:
    pool: FakePool
    # Set by the test to let a held write finish.
    go: threading.Event = field(default_factory=threading.Event)
    # Each finished write: whether the pool was closed when it was made.
    done: list[bool] = field(default_factory=list[bool])
    started: threading.Event = field(default_factory=threading.Event)


@pytest.fixture
def writes(monkeypatch: pytest.MonkeyPatch) -> Iterator[Writes]:
    pool = FakePool()
    held = Writes(pool)

    def record_end(_pool: Pool, _hash: bytes, _session: object, _reason: str) -> str:
        held.started.set()
        held.go.wait(10.0)
        held.done.append(pool.closed)
        return db_live.RECORDED

    def open_pool(_url: str) -> Pool:
        return cast(Pool, pool)

    monkeypatch.setattr(app_module, "open_pool", open_pool)
    monkeypatch.setattr(db_live, "record_end", record_end)
    yield held
    held.go.set()  # never leave a worker thread waiting


def _stop_with_a_write_running(writes: Writes) -> None:
    """Start the app, have a `hello` find its session expired, and stop the app while the end's
    write is still running."""
    settings = Settings(database_url="postgresql://unused", site_origin=SITE)
    app = create_app(settings, live_recheck=None)
    with TestClient(app) as client:
        service = cast(LiveService, app.state.live)
        now = service.clock()
        started = service.registry.start(uuid.uuid4(), uuid.uuid4(), b"d" * 32, now)
        assert started is not None
        service.clock = lambda: now + HOST_AWAY_LIMIT  # the host never connected
        with client.websocket_connect(WS) as ws:  # pyright: ignore[reportUnknownMemberType]
            ws.send_json(hello(started.host_token))
            assert closed(ws) == 4401
        assert writes.started.wait(3.0)


def test_an_end_being_written_at_shutdown_is_written_before_the_pool_closes(
    writes: Writes,
) -> None:
    # The write finishes a moment after the stop began.
    threading.Timer(0.3, writes.go.set).start()
    _stop_with_a_write_running(writes)
    assert writes.done == [False]
    assert writes.pool.closed


def test_a_write_that_does_not_finish_does_not_hold_the_shutdown(
    writes: Writes, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_module, "LIVE_DRAIN_WITHIN", 0.2)
    # The write would finish long after the bound: the pool is closed before it does.
    threading.Timer(1.5, writes.go.set).start()
    _stop_with_a_write_running(writes)
    assert until(lambda: writes.done != [])
    assert writes.done == [True]  # it found the pool closed (a real one raises HandleClosed)
    assert writes.pool.closed
