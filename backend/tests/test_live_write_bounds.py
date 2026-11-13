"""The audit write of an expired session's end, on fakes (live/service.py, `_expired`, `drain`;
ADR 0002, section 8; #225 N3 and N4, #242).

- while a slow write runs, the event loop still serves another task (the write is off the loop);
- `drain` waits for a write that finishes within the bound, and says none is left;
- a write that misses the bound is logged as `live.end_not_recorded`, with a fixed word only.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from typing import cast

import pytest

from player_backend.db import live as db_live
from player_backend.db.executor import Pool
from player_backend.live.registry import Ended, Registry
from player_backend.live.service import LiveService

DEVICE_HASH = b"secret-device-hash-never-logged!"


def _ended() -> Ended:
    return Ended(uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), DEVICE_HASH, "host_away")


def _service(monkeypatch: pytest.MonkeyPatch, release: threading.Event) -> LiveService:

    def record_end(_pool: Pool, _hash: bytes, _session: object, _reason: str) -> str:
        release.wait(10.0)
        return db_live.RECORDED

    monkeypatch.setattr(db_live, "record_end", record_end)
    return LiveService(Registry(), cast(Pool, object()))


def test_a_slow_write_does_not_block_the_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    release = threading.Event()
    service = _service(monkeypatch, release)

    async def scenario() -> int:
        service._expired(_ended())  # pyright: ignore[reportPrivateUsage]
        ticks = 0
        for _ in range(5):  # the write holds its thread; the loop goes on meanwhile
            await asyncio.sleep(0.01)
            ticks += 1
        assert service._writes  # pyright: ignore[reportPrivateUsage]  # still held, loop free
        release.set()
        assert await service.drain(3.0)
        return ticks

    try:
        assert asyncio.run(scenario()) == 5
    finally:
        release.set()


def test_drain_waits_for_a_write_within_the_bound(monkeypatch: pytest.MonkeyPatch) -> None:
    release = threading.Event()
    service = _service(monkeypatch, release)

    async def scenario() -> bool:
        service._expired(_ended())  # pyright: ignore[reportPrivateUsage]
        asyncio.get_running_loop().call_later(0.1, release.set)
        return await service.drain(3.0)

    try:
        assert asyncio.run(scenario())
    finally:
        release.set()


def test_a_write_that_misses_the_bound_is_logged_with_a_fixed_line(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    release = threading.Event()
    service = _service(monkeypatch, release)
    ended = _ended()

    async def scenario() -> bool:
        service._expired(ended)  # pyright: ignore[reportPrivateUsage]
        try:
            return await service.drain(0.1)
        finally:
            release.set()  # let the worker thread go

    with caplog.at_level(logging.INFO, logger="player_backend.live.service"):
        assert asyncio.run(scenario()) is False
    lines = [
        r
        for r in caplog.records
        if getattr(r, "fields", {}).get("event") == "live.end_not_recorded"
    ]
    assert len(lines) == 1
    assert lines[0].levelno == logging.WARNING
    shown = " ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records)
    for secret in (str(ended.session_id), str(ended.device_id), str(ended.account_id), "secret"):
        assert secret not in shown
