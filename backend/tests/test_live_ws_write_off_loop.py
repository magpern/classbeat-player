"""The audit write of a session a `hello` finds expired runs off the event loop, on fakes
(live/service.py, `_expired`; ADR 0002, section 8; ADR 0005, section 6; #225 N3, #227).

The write is a database call that may wait for a pool connection: on the loop it would hold
every live connection still. The fake write below notes whether an event loop was running in
its thread, and which thread it was; a write made on the loop is caught by either.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterator
from typing import Any

import pytest

from player_backend.db import live as db_live
from player_backend.db.executor import Pool
from player_backend.live_session_policy import HOST_AWAY_LIMIT
from tests.livehelp import SITE, closed, hello, live_app, until


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    with live_app(monkeypatch) as running:
        yield running


def _on_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _noted(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, bool, int]]:
    """Each write: the end's reason, whether a loop ran in its thread, and the thread."""
    writes: list[tuple[str, bool, int]] = []

    def record_end(_pool: Pool, _hash: bytes, _session: object, reason: str) -> str:
        writes.append((reason, _on_loop(), threading.get_ident()))
        return db_live.RECORDED

    monkeypatch.setattr(db_live, "record_end", record_end)
    return writes


async def _thread_of_loop() -> int:
    return threading.get_ident()


@pytest.mark.parametrize("role", ["host", "controller"])
def test_the_write_of_an_end_a_hello_finds_runs_off_the_loop(
    live: Any, monkeypatch: pytest.MonkeyPatch, role: str
) -> None:
    writes = _noted(monkeypatch)
    started = live.session()
    token = started.host_token if role == "host" else live.controller(started)
    live.clock.now += HOST_AWAY_LIMIT  # the host never connected: the session has expired
    with live.connect(None if role == "host" else SITE) as ws:
        loop_thread = ws.portal.call(_thread_of_loop)
        ws.send_json(hello(token))
        assert closed(ws) == 4401
    assert live.registry.running() == []
    assert until(lambda: writes != [])
    assert len(writes) == 1
    reason, on_loop, thread = writes[0]
    assert reason == "host_away"
    assert not on_loop
    assert thread != loop_thread
