"""The live sessions, in the live process's memory only (ADR 0002, section 8; ADR 0005, s. 2, 3;
ADR 0007, s. 2, 3).

Nothing here is written to the database, and nothing but a watcher's error type to a log. A
session holds its account, its device, the hash of the device token that started it, the hash of
its host token, its join code, its control code (as a hash, live_code_policy.py) and its times;
the clear host token, control code and controller token are each given out once and never kept.
A controller got by sign-in holds the hash of the site session that asked (for the re-check); a
controller token is held as its hash only, and so is a rider token, with its rider id and
nickname.

Thread-safe: the routes, the WebSocket and the re-check's thread all call it. The state is
live/table.py's, the controllers and control codes live/controllers.py's, the riders, the lock
and the new join code live/riders.py's; this module starts, finds and ends sessions. The
watchers (live/watchers.py) are told after the lock is released, on the caller's thread.
"""

from __future__ import annotations

import uuid
from typing import cast
from uuid import UUID

from player_backend.code_policy import normalise_code, show_code
from player_backend.live.controllers import Controllers
from player_backend.live.events import (
    Dropped,
    Ended,
    Running,
    Seat,
    SignedInController,
    Started,
)
from player_backend.live.riders import Riders
from player_backend.live.table import SLOTS, HeldSession
from player_backend.live.watchers import Watcher
from player_backend.live_session_policy import EndReason, Held, expiry, plan_start
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token, token_hash

__all__ = [
    "SLOTS",
    "Dropped",
    "Ended",
    "Registry",
    "Running",
    "Seat",
    "SignedInController",
    "Started",
    "Watcher",
]


class Registry(Controllers, Riders):
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
            session = HeldSession(
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
            ended = self._expired(session, now)
            if ended is None:
                return session.id
        # Its lifetime was over: it ends now, and is recorded, as the sweep would have ended it.
        self._expiry_told(ended)
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
