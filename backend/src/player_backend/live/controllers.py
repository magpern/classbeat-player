"""The controllers of the live sessions and their control codes (ADR 0002, section 8; ADR
0005, section 3), on the registry's state (live/table.py).

- At most 2 controllers a session, counted as controller tokens held, in slots 1 and 2.
- By sign-in: only for a sign-in of the session's own account. By control code: the join code
  names the session and the code is compared with that session's current one only; the code's
  rules are live_code_policy.py's.
- A controller token is given out once, in `Granted`, and held as its hash only.
- The host's `drop` ends the current control code without telling anyone, and drops the slot's
  controller.
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from player_backend.code_issue import new_code
from player_backend.code_policy import code_hash, normalise_code, show_code
from player_backend.live.events import (
    CodeCancelled,
    Dropped,
    Exchange,
    Granted,
    MadeCode,
    Seat,
    SignedInController,
)
from player_backend.live.table import HeldController, HeldSession, Table
from player_backend.live_session_policy import expiry
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token, token_hash


class Controllers(Table):
    def _hold(self, session: HeldSession, hashed: bytes, site_hash: bytes | None) -> int | None:
        slot = session.free_slot()
        if slot is None or hashed in self._by_controller:
            return None
        session.controllers[slot] = HeldController(hashed, site_hash)
        self._by_controller[hashed] = (session.id, slot)
        return slot

    def add_controller(
        self, session_id: UUID, token_hash: bytes, site_session_hash: bytes | None
    ) -> int | None:
        """Hold a controller in the first free slot; None when the session is gone or full."""
        with self._lock:
            session = self._sessions.get(session_id)
            return None if session is None else self._hold(session, token_hash, site_session_hash)

    def _grant(self, session: HeldSession, site_session_hash: bytes | None) -> Granted | None:
        token = new_token("ctl")
        slot = self._hold(session, token_hash(token), site_session_hash)
        return None if slot is None else Granted(session.id, slot, token, session.device_hash)

    def sign_in_controller(
        self, session_id: UUID, account_id: UUID, site_session_hash: bytes, now: float
    ) -> Granted | None:
        """A controller for a sign-in of the session's own account; None for any other account,
        when both places are held, or when the session is gone. A session past its lifetime
        ends, as in `host_session`."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.account_id != account_id:
                return None
            ended = self._expired(session, now)
            if ended is None:
                return self._grant(session, site_session_hash)
        self._tell([ended])
        return None

    def release(self, granted: Granted) -> bool:
        """Take back a grant whose token was never given out: its place is freed while that
        token still holds it. No watcher is told, as no phone holds the token."""
        hashed = token_hash(granted.token)
        with self._lock:
            session = self._sessions.get(granted.session_id)
            held = None if session is None else session.controllers.get(granted.slot)
            if session is None or held is None or held.token_hash != hashed:
                return False
            del session.controllers[granted.slot]
            self._by_controller.pop(hashed, None)
            return True

    def make_code(self, session_id: UUID, now: float) -> MadeCode | None:
        """A new control code for the host, replacing the current one; None when the session is
        gone or has made its 30 this hour (the current code then stays as it was)."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            code = new_code()
            made, earlier = session.code.make(code_hash(code), now)
            if not made:
                return None
            return MadeCode(show_code(code), session.code.expires_in_ms(now), earlier)

    def exchange(self, raw_session: object, raw_code: object, now: float) -> Exchange:
        """`POST /api/live/control`: the join code names the session; the code is compared with
        that session's current one only (live_code_policy.py). A session past its lifetime ends,
        as in `host_session`, and its join code names no session any more."""
        join, code = normalise_code(raw_session), normalise_code(raw_code)
        with self._lock:
            found = None if join is None else self._by_code.get(join)
            session = None if found is None else self._sessions.get(found)
            ended = None if session is None else self._expired(session, now)
            if session is None or ended is not None:
                exchanged = Exchange(None, "unknown", None, b"")
            else:
                exchanged = self._tried(session, code, now)
        self._tell([e for e in (ended, exchanged.cancelled) if e is not None])
        return exchanged

    def _tried(self, session: HeldSession, code: str | None, now: float) -> Exchange:
        if code is None:  # not reached: the route checks the body's schema first
            return Exchange(None, "wrong", None, session.device_hash)
        tried = session.code.tried(code_hash(code), session.free_slot() is not None, now)
        granted = self._grant(session, None) if tried.outcome == "right" else None
        ended = tried.cancelled
        cancelled = None if ended is None else CodeCancelled(session.id, ended)
        refusal = None if granted else ("wrong" if tried.outcome == "wrong" else "full")
        return Exchange(granted, refusal, cancelled, session.device_hash)

    def codes_due(self, now: float) -> list[CodeCancelled]:
        """End every control code whose 2 minutes are over by `now`."""
        with self._lock:
            sessions = self._sessions.values()
            due = [CodeCancelled(s.id, "expired") for s in sessions if s.code.expire(now)]
        self._tell(due)
        return due

    def controller_seat(self, token: object, now: float) -> Seat | None:
        """The place a controller token holds, or None. Only `cbp_ctl_` is looked up; the slot's
        holder must be this token, and a session past its lifetime ends, as in `host_session`."""
        if not is_token("ctl", token):
            return None
        hashed = token_hash(cast(str, token))
        with self._lock:
            found = self._by_controller.get(hashed)
            session = None if found is None else self._sessions.get(found[0])
            if found is None or session is None:
                return None
            held = session.controllers.get(found[1])
            if held is None or held.token_hash != hashed:
                return None
            reason = expiry(session.clocks(), now)
            if reason is None:
                return Seat(
                    found[0], found[1], "code" if held.site_session_hash is None else "sign_in"
                )
            ended = self._remove(session.id, reason)
        self._tell([ended] if ended else [])
        return None

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
            if dropped and session is not None and held is not None:
                del session.controllers[slot]
                self._by_controller.pop(held.token_hash, None)
        if dropped:
            self._tell([Dropped(session_id, slot)])
        return dropped

    def host_drop(self, session_id: UUID, slot: int) -> bool:
        """The host's `drop`: the current control code ends, and no one is told of that (the
        app clears the code it shows), and the controller in `slot` is dropped."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is not None:
                session.code.end()
        return self.drop_controller(session_id, slot)
