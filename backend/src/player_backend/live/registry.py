"""The live sessions, in the live process's memory only (ADR 0002, section 8; ADR 0005, s. 2).

Nothing here is written to the database or a log. A session holds its account, its device, the
hash of the device token that started it, the hash of its host token, its join code and its
times; the clear host token is given out once, in `Started`, and never kept. A controller got by
sign-in holds the hash of the site session that asked (for the re-check); a controller token is
held as its hash only.

Thread-safe: the routes, the WebSocket and the re-check's thread all call it. The watchers are
called after the lock is released, on the caller's thread: a watcher that touches an event loop
hands its work over to that loop.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Final, cast
from uuid import UUID

from player_backend.code_issue import new_code
from player_backend.code_policy import normalise_code, show_code
from player_backend.live_session_policy import Clocks, EndReason, Held, expiry, plan_start
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token, token_hash

# ADR 0002, section 8: at most 2 controllers per session, in slots 1 and 2.
SLOTS: Final = (1, 2)


@dataclass(frozen=True)
class Ended:
    """A session that has ended, and why. Its connections are closed with 4403."""

    session_id: UUID
    account_id: UUID
    device_id: UUID
    device_hash: bytes = field(repr=False)
    reason: EndReason


@dataclass(frozen=True)
class Dropped:
    """A controller dropped from a session that goes on. Its connection is closed with 4403."""

    session_id: UUID
    slot: int


@dataclass(frozen=True)
class Started:
    session_id: UUID
    join_code: str  # as shown: XXXX-XXXX
    host_token: str = field(repr=False)  # given out once, here
    replaced: tuple[Ended, ...]


@dataclass(frozen=True)
class Running:
    """A running session, as the re-check sees it."""

    session_id: UUID
    account_id: UUID
    device_hash: bytes = field(repr=False)


@dataclass(frozen=True)
class SignedInController:
    """A controller got by sign-in, as the re-check sees it."""

    session_id: UUID
    slot: int
    site_session_hash: bytes = field(repr=False)


@dataclass
class _Controller:
    token_hash: bytes
    site_session_hash: bytes | None


@dataclass
class _Session:
    id: UUID
    account_id: UUID
    device_id: UUID
    device_hash: bytes
    host_hash: bytes
    join_code: str
    started_at: float
    host_away_since: float | None
    confirmed_at: float
    controllers: dict[int, _Controller] = field(default_factory=dict[int, _Controller])

    def clocks(self) -> Clocks:
        return Clocks(self.started_at, self.host_away_since, self.confirmed_at)


type Watcher = Callable[[Ended | Dropped], None]


class Registry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[UUID, _Session] = {}
        self._by_host: dict[bytes, UUID] = {}
        self._by_code: dict[str, UUID] = {}
        self._watchers: list[Watcher] = []

    def watch(self, watcher: Watcher) -> None:
        """Call `watcher` for every session that ends and every controller that is dropped."""
        with self._lock:
            self._watchers.append(watcher)

    def _tell(self, events: list[Ended] | list[Dropped]) -> None:
        with self._lock:
            watchers = list(self._watchers)
        for event in events:
            for watcher in watchers:
                watcher(event)

    def _remove(self, session_id: UUID, reason: EndReason) -> Ended | None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return None
        del self._by_host[session.host_hash]
        del self._by_code[session.join_code]
        return Ended(session.id, session.account_id, session.device_id, session.device_hash, reason)

    def _new_code(self) -> str:
        while True:
            code = new_code()
            if code not in self._by_code:
                return code

    def start(
        self, account_id: UUID, device_id: UUID, device_hash: bytes, now: float
    ) -> Started | None:
        """A new session of the device, ending its earlier one; None when the account is full."""
        with self._lock:
            held = [Held(s.id, s.account_id, s.device_id) for s in self._sessions.values()]
            plan = plan_start(held, account_id, device_id)
            if plan.full:
                return None
            replaced = [e for e in (self._remove(i, "replaced") for i in plan.replaced) if e]
            host_token = new_token("hst")
            session = _Session(
                id=uuid.uuid4(),
                account_id=account_id,
                device_id=device_id,
                device_hash=device_hash,
                host_hash=token_hash(host_token),
                join_code=self._new_code(),
                started_at=now,
                # Never connected yet: the 15 minutes run from the start.
                host_away_since=now,
                confirmed_at=now,
            )
            self._sessions[session.id] = session
            self._by_host[session.host_hash] = session.id
            self._by_code[session.join_code] = session.id
        self._tell(replaced)
        return Started(session.id, show_code(session.join_code), host_token, tuple(replaced))

    def discard(self, session_id: UUID) -> None:
        """Take back a start whose host token was never given out. No watcher is told."""
        with self._lock:
            self._remove(session_id, "host_ended")

    def end(self, session_id: UUID, reason: EndReason) -> Ended | None:
        """End one session. None when it is not running (any more)."""
        with self._lock:
            ended = self._remove(session_id, reason)
        if ended is not None:
            self._tell([ended])
        return ended

    def end_due(self, now: float) -> list[Ended]:
        """End every session whose lifetime is over by `now`."""
        with self._lock:
            due: list[tuple[UUID, EndReason]] = []
            for session in self._sessions.values():
                reason = expiry(session.clocks(), now)
                if reason is not None:
                    due.append((session.id, reason))
            ended = [e for e in (self._remove(i, r) for i, r in due) if e is not None]
        self._tell(ended)
        return ended

    def host_session(self, token: object, now: float) -> UUID | None:
        """The session a host token is for, or None. Only `cbp_hst_` is looked up at all."""
        if not is_token("hst", token):
            return None
        with self._lock:
            found = self._by_host.get(token_hash(cast(str, token)))
            session = None if found is None else self._sessions.get(found)
            if session is None:
                return None
            reason = expiry(session.clocks(), now)
            if reason is None:
                return session.id
            ended = self._remove(session.id, reason)
        # Its lifetime was over: it ends now, as the sweep would have ended it.
        self._tell([ended] if ended else [])
        return None

    def session_of_code(self, raw_code: object) -> UUID | None:
        """The session a join code names, or None. The code names it and grants nothing."""
        code = normalise_code(raw_code)
        if code is None:
            return None
        with self._lock:
            return self._by_code.get(code)

    def host_connected(self, session_id: UUID) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is not None:
                session.host_away_since = None
            return session is not None

    def host_lost(self, session_id: UUID, now: float) -> bool:
        """The host's connection is gone: the 15 minutes start now."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is not None and session.host_away_since is None:
                session.host_away_since = now
            return session is not None

    def running(self, account_id: UUID | None = None) -> list[Running]:
        """The running sessions, of one account or of all."""
        with self._lock:
            return [
                Running(s.id, s.account_id, s.device_hash)
                for s in self._sessions.values()
                if account_id is None or s.account_id == account_id
            ]

    def confirm(self, session_ids: list[UUID], now: float) -> None:
        """The re-check found these sessions' devices still active at `now`."""
        with self._lock:
            for session_id in session_ids:
                session = self._sessions.get(session_id)
                if session is not None:
                    session.confirmed_at = now

    def add_controller(
        self, session_id: UUID, token_hash: bytes, site_session_hash: bytes | None
    ) -> int | None:
        """Hold a controller in the first free slot; None when the session is gone or full."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            free = [slot for slot in SLOTS if slot not in session.controllers]
            if not free:
                return None
            session.controllers[free[0]] = _Controller(token_hash, site_session_hash)
            return free[0]

    def signed_in_controllers(self, account_id: UUID | None = None) -> list[SignedInController]:
        with self._lock:
            return [
                SignedInController(s.id, slot, c.site_session_hash)
                for s in self._sessions.values()
                if account_id is None or s.account_id == account_id
                for slot, c in s.controllers.items()
                if c.site_session_hash is not None
            ]

    def drop_controller(
        self, session_id: UUID, slot: int, site_session_hash: bytes | None = None
    ) -> bool:
        """Drop the controller in `slot`; with `site_session_hash`, only the one it holds."""
        with self._lock:
            session = self._sessions.get(session_id)
            held = None if session is None else session.controllers.get(slot)
            dropped = held is not None and (
                site_session_hash is None or held.site_session_hash == site_session_hash
            )
            if dropped and session is not None:
                del session.controllers[slot]
        if dropped:
            self._tell([Dropped(session_id, slot)])
        return dropped
