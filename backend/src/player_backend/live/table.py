"""The state the live registry keeps, under one lock (live/registry.py): the sessions, found by
id, by host token hash, by join code, by controller token hash and by rider token hash; and who
is told what ends.

`Table` holds it; `Controllers` (live/controllers.py), `Riders` (live/riders.py) and `Registry`
(live/registry.py) act on it.
Every method that reads or changes it holds `_lock`; the watchers are told after it is released.

A session found past its lifetime outside the sweep (`host_session`, `controller_seat`, the
control-code exchange, `sign_in_controller`) ends there, and its end is handed to the recorder
the service set (`record_expiries`), as the sweep's are: the service writes `live.session_ended`.
A session ends once (`_remove` answers None after that), so its end is handed over once.
"""

from __future__ import annotations

import threading
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Final
from uuid import UUID

from player_backend.code_issue import new_code
from player_backend.live.events import Ended
from player_backend.live.watchers import Watcher, Watchers
from player_backend.live_code_policy import ControlCode
from player_backend.live_limit_policy import Window
from player_backend.live_rider_policy import JOIN_CODES_PER_HOUR, JOINS_PER_MINUTE
from player_backend.live_session_policy import Clocks, EndReason, expiry

# ADR 0002, section 8: at most 2 controllers per session, in slots 1 and 2.
SLOTS: Final = (1, 2)


@dataclass
class HeldController:
    token_hash: bytes = field(repr=False)
    site_session_hash: bytes | None = field(repr=False)


@dataclass
class HeldRider:
    """A rider token, held as its hash. The nickname is held for the host only (ADR 0007)."""

    token_hash: bytes = field(repr=False)
    nickname: str = field(repr=False)
    away_since: float  # since its last connection closed, or since the join
    connections: int = 0  # open now: a new one replacing the old counts both for a moment


def _joins() -> Window:
    return Window(JOINS_PER_MINUTE, 60.0)


def _join_codes() -> Window:
    return Window(JOIN_CODES_PER_HOUR, 3600.0)


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
    # Rider id -> rider, in the order they joined.
    riders: dict[str, HeldRider] = field(default_factory=dict[str, HeldRider], repr=False)
    locked: bool = False
    joins: Window = field(default_factory=_joins, repr=False)
    join_codes: Window = field(default_factory=_join_codes, repr=False)

    def clocks(self) -> Clocks:
        return Clocks(self.started_at, self.host_away_since, self.confirmed_at)

    def free_slot(self) -> int | None:
        return next((slot for slot in SLOTS if slot not in self.controllers), None)

    def riders_connected(self) -> int:
        return sum(1 for rider in self.riders.values() if rider.connections > 0)


class Table:
    """The registry's state. See live/registry.py for the whole."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[UUID, HeldSession] = {}
        self._by_host: dict[bytes, UUID] = {}
        self._by_code: dict[str, UUID] = {}
        # A controller token's hash -> its session and slot (the WebSocket's `hello`).
        self._by_controller: dict[bytes, tuple[UUID, int]] = {}
        # A rider token's hash -> its session and rider id.
        self._by_rider: dict[bytes, tuple[UUID, str]] = {}
        # Host requests ignored over a limit, by kind (`join_code_limit`: ADR 0007, section 3).
        self.ignored: Counter[str] = Counter()
        self._watchers = Watchers()
        self._tell = self._watchers.tell
        self._recorder: Callable[[Ended], None] | None = None

    def watch(self, watcher: Watcher) -> None:
        """Call `watcher` for every session that ends, every controller that is dropped and
        every control code that is cancelled."""
        self._watchers.add(watcher)

    def record_expiries(self, recorder: Callable[[Ended], None]) -> None:
        """Call `recorder` for every session ended on expiry outside the sweep (the sweep's
        caller records those of `end_due` itself)."""
        self._recorder = recorder

    def _expiry_told(self, ended: Ended | None) -> None:
        """Tell the watchers of a session ended on expiry outside the sweep, then hand it to the
        recorder. Call with `_lock` released: the recorder writes to the database."""
        if ended is None:
            return
        self._tell([ended])
        if self._recorder is not None:
            self._recorder(ended)

    def _new_code(self) -> str:
        """A join code no running session has. Hold `_lock`."""
        while True:
            code = new_code()
            if code not in self._by_code:
                return code

    def _remove(self, session_id: UUID, reason: EndReason) -> Ended | None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return None
        del self._by_host[session.host_hash]
        del self._by_code[session.join_code]
        for held in session.controllers.values():
            self._by_controller.pop(held.token_hash, None)
        for rider in session.riders.values():
            self._by_rider.pop(rider.token_hash, None)
        return Ended(session.id, session.account_id, session.device_id, session.device_hash, reason)

    def _expired(self, session: HeldSession, now: float) -> Ended | None:
        """End `session` when its lifetime is over by `now`, as the sweep would; hold `_lock`
        and tell the watchers of what it returns once the lock is released."""
        reason = expiry(session.clocks(), now)
        return None if reason is None else self._remove(session.id, reason)
