"""The state the live registry keeps, under one lock (live/registry.py): the sessions, found by
id, by host token hash, by join code and by controller token hash; and who is told what ends.

`Table` holds it; `Controllers` (live/controllers.py) and `Registry` (live/registry.py) act on it.
Every method that reads or changes it holds `_lock`; the watchers are told after it is released.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Final
from uuid import UUID

from player_backend.live.events import Ended
from player_backend.live.watchers import Watcher, Watchers
from player_backend.live_code_policy import ControlCode
from player_backend.live_session_policy import Clocks, EndReason, expiry

# ADR 0002, section 8: at most 2 controllers per session, in slots 1 and 2.
SLOTS: Final = (1, 2)


@dataclass
class HeldController:
    token_hash: bytes = field(repr=False)
    site_session_hash: bytes | None = field(repr=False)


@dataclass
class HeldSession:
    id: UUID
    account_id: UUID
    device_id: UUID
    device_hash: bytes = field(repr=False)
    host_hash: bytes = field(repr=False)
    join_code: str
    started_at: float
    host_away_since: float | None
    confirmed_at: float
    controllers: dict[int, HeldController] = field(default_factory=dict[int, HeldController])
    code: ControlCode = field(default_factory=ControlCode, repr=False)

    def clocks(self) -> Clocks:
        return Clocks(self.started_at, self.host_away_since, self.confirmed_at)

    def free_slot(self) -> int | None:
        return next((slot for slot in SLOTS if slot not in self.controllers), None)


class Table:
    """The registry's state. See live/registry.py for the whole."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[UUID, HeldSession] = {}
        self._by_host: dict[bytes, UUID] = {}
        self._by_code: dict[str, UUID] = {}
        # A controller token's hash -> its session and slot (the WebSocket's `hello`).
        self._by_controller: dict[bytes, tuple[UUID, int]] = {}
        self._watchers = Watchers()
        self._tell = self._watchers.tell

    def watch(self, watcher: Watcher) -> None:
        """Call `watcher` for every session that ends, every controller that is dropped and
        every control code that is cancelled."""
        self._watchers.add(watcher)

    def _remove(self, session_id: UUID, reason: EndReason) -> Ended | None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return None
        del self._by_host[session.host_hash]
        del self._by_code[session.join_code]
        for held in session.controllers.values():
            self._by_controller.pop(held.token_hash, None)
        return Ended(session.id, session.account_id, session.device_id, session.device_hash, reason)

    def _expired(self, session: HeldSession, now: float) -> Ended | None:
        """End `session` when its lifetime is over by `now`, as the sweep would; hold `_lock`
        and tell the watchers of what it returns once the lock is released."""
        reason = expiry(session.clocks(), now)
        return None if reason is None else self._remove(session.id, reason)
