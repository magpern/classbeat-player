"""The re-check loop and its listener (ADR 0002, section 8; ADR 0005, section 2).

One thread of the live process:

- it keeps a connection of its own listening on `live_revocations`. A notice names an account;
  that account's sessions are re-checked at once. A notice carries no authority: only the
  re-check's answer ends anything;
- every 30 seconds it re-checks every session, so a missed notice takes effect within 30 s;
- when the listening connection is lost (or cannot be opened), it opens it again after 1, 2, 4,
  8 then every 15 seconds, and re-checks every session at once when it is back; the 30-second
  re-check goes on meanwhile;
- every tick (1 second) it ends the sessions whose lifetime is over.

An unexpected error is logged by its type alone and the loop goes on: the re-check never stops
while the process runs.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from contextlib import ExitStack
from dataclasses import dataclass

from player_backend.db import live
from player_backend.db.executor import DatabaseError, Listener
from player_backend.live.service import LiveService
from player_backend.live_session_policy import (
    RECHECK_EVERY,
    listen_retry_after,
    notice_account,
)

_log = logging.getLogger("player_backend.live")


@dataclass(frozen=True)
class RecheckTiming:
    every: float = RECHECK_EVERY  # the full re-check
    tick: float = 1.0  # the longest wait: the sweep's step and how soon `stop` is seen


class RecheckLoop:
    def __init__(
        self,
        service: LiveService,
        conninfo: str,
        timing: RecheckTiming,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._service = service
        self._conninfo = conninfo
        self._timing = timing
        self._clock = clock
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="live-recheck", daemon=True)
        self._stack = ExitStack()
        self._listener: Listener | None = None
        self._failures = 0
        self._retry_at = 0.0
        self._next_full = 0.0

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=self._timing.tick + 5.0)

    def _lost(self, now: float) -> None:
        self._stack.close()
        self._listener = None
        self._failures += 1
        self._retry_at = now + listen_retry_after(self._failures)
        _log.warning("live listener lost", extra={"fields": {"failures": self._failures}})

    def _open(self, now: float) -> None:
        try:
            self._listener = self._stack.enter_context(live.listening(self._conninfo))
        except DatabaseError:
            self._lost(now)
            return
        self._failures = 0
        # Back (or there for the first time): every session is re-checked at once.
        self._next_full = now

    def step(self) -> None:
        """One round: listen, re-check what is due, end what has run out, wait."""
        now = self._clock()
        if self._listener is None and now >= self._retry_at:
            self._open(now)
        if now >= self._next_full:
            self._service.recheck(None)
            self._next_full = now + self._timing.every
        self._service.sweep()
        wait = max(0.0, min(self._timing.tick, self._next_full - self._clock()))
        if self._listener is None:
            self._stop.wait(wait)
            return
        try:
            payloads = self._listener.wait(wait)
        except DatabaseError:
            self._lost(self._clock())
            return
        accounts = {a for a in (notice_account(p) for p in payloads) if a is not None}
        for account_id in accounts:
            self._service.recheck(account_id)

    def _run(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    self.step()
                except Exception as error:  # the loop must not die: log the type, go on
                    _log.error(
                        "live re-check error", extra={"fields": {"error": type(error).__name__}}
                    )
                    self._stop.wait(self._timing.tick)
        finally:
            self._stack.close()
