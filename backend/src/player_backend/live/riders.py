"""The riders of the live sessions, and the host's lock and new join code (ADR 0007, sections 2
and 3; ADR 0002, sections 8 and 10), on the registry's state (live/table.py).

- A join (`POST /api/live/join`) names the session by its current join code. It is refused, with
  one answer for every cause, when no session has the code (an earlier code included: the
  caller's address is counted for it, by the service), when the session is locked, when 60
  riders are connected, or past its 120 joins a minute. Otherwise it gets a rider token, given
  out once and held as its hash, and a rider id of 8 random bytes, the same for the token's life.
- Nothing about a rider is written anywhere: the token's hash, its id and its nickname are in
  this memory only, and go with the token or the session.
- Places: a rider token's connection is counted (`rider_connected`, `rider_disconnected`, for
  the WebSocket). At most 60 tokens are connected at a time; a token already connected may open
  a new connection that replaces its old one. A token with no connection for 5 minutes, or that
  never connected, is dropped by the sweep (`riders_due`), and no one is told.
- Lock: every join is refused while it is on; riders in, and a token that left and comes back
  within its 5 minutes, stay. A session starts unlocked; the lock survives a new join code.
- New join code: from then on the earlier code finds nothing, for joins and for the controller
  routes; the current control code ends, and no one is told of that (the app clears the code it
  shows). Riders and controllers in stay. 10 a session an hour; more are ignored and counted.
- Remove (`drop_rider`): the rider's token is dropped at once; the WebSocket closes its
  connection.
"""

from __future__ import annotations

import secrets
from typing import cast
from uuid import UUID

from player_backend.code_policy import normalise_code, show_code
from player_backend.live.events import JoinRefusal, RiderIn, RiderSeat
from player_backend.live.table import HeldRider, HeldSession, Table
from player_backend.live_rider_policy import RIDER_ID_BYTES, gone, has_place, rider_id
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token, token_hash


class Riders(Table):
    def _new_rider_id(self, session: HeldSession) -> str:
        while True:
            found = rider_id(secrets.token_bytes(RIDER_ID_BYTES))
            if found not in session.riders:
                return found

    def join(self, raw_code: object, nickname: str, now: float) -> str | JoinRefusal:
        """A rider token for a join with `raw_code`, or why not. `nickname` is already clean
        (live_rider_policy.py). A session past its lifetime ends, as in `host_session`."""
        code = normalise_code(raw_code)
        with self._lock:
            found = None if code is None else self._by_code.get(code)
            session = None if found is None else self._sessions.get(found)
            ended = None if session is None else self._expired(session, now)
            if session is None or ended is not None:
                answer: str | JoinRefusal = "unknown"
            elif not session.joins.take(now) or session.locked:
                answer = "refused"
            elif not has_place(session.riders_connected(), False):
                answer = "refused"
            else:
                answer = new_token("rdr")
                hashed = token_hash(answer)
                rider = self._new_rider_id(session)
                session.riders[rider] = HeldRider(hashed, nickname, away_since=now)
                self._by_rider[hashed] = (session.id, rider)
        self._expiry_told(ended)
        return answer

    def _rider_of(self, token: object) -> tuple[HeldSession, str, HeldRider] | None:
        """The session, id and rider a rider token is for. Hold `_lock`."""
        if not is_token("rdr", token):
            return None
        hashed = token_hash(cast(str, token))
        found = self._by_rider.get(hashed)
        session = None if found is None else self._sessions.get(found[0])
        held = None if session is None or found is None else session.riders.get(found[1])
        if session is None or found is None or held is None or held.token_hash != hashed:
            return None
        return session, found[1], held

    def rider_connected(self, token: object, now: float) -> RiderSeat | None:
        """Count a new connection of a rider token; None when the token is not held, or when 60
        other tokens are connected. Only `cbp_rdr_` is looked up. A session past its lifetime
        ends, as in `host_session`."""
        with self._lock:
            found = self._rider_of(token)
            if found is None:
                return None
            session, rider, held = found
            ended = self._expired(session, now)
            if ended is None:
                if not has_place(session.riders_connected(), held.connections > 0):
                    return None
                held.connections += 1
                return RiderSeat(session.id, rider, held.nickname, held.connections == 1)
        self._expiry_told(ended)
        return None

    def rider_disconnected(self, session_id: UUID, rider: str, now: float) -> bool:
        """A rider token's connection closed. True when it was the token's last one: the host
        is told `rider_left` `left`, and the token's 5 minutes start now."""
        with self._lock:
            session = self._sessions.get(session_id)
            held = None if session is None else session.riders.get(rider)
            if held is None or held.connections == 0:
                return False
            held.connections -= 1
            if held.connections > 0:
                return False
            held.away_since = now
            return True

    def riders_due(self, now: float) -> int:
        """Drop every rider token with no connection for its 5 minutes; how many. No one is
        told: the host heard `rider_left` when the last connection closed, or never heard of a
        token that never connected."""
        dropped = 0
        with self._lock:
            for session in self._sessions.values():
                riders = session.riders.items()
                due = [r for r, held in riders if gone(held.connections, held.away_since, now)]
                for rider in due:
                    self._by_rider.pop(session.riders.pop(rider).token_hash, None)
                dropped += len(due)
        return dropped

    def riders_in(self, session_id: UUID) -> list[RiderIn]:
        """The riders connected now, in the order they joined (the host's list)."""
        with self._lock:
            session = self._sessions.get(session_id)
            riders = {} if session is None else session.riders
            return [RiderIn(r, held.nickname) for r, held in riders.items() if held.connections]

    def drop_rider(self, session_id: UUID, rider: str) -> bool:
        """The host removed the rider: its token is dropped. False when it is not held."""
        with self._lock:
            session = self._sessions.get(session_id)
            held = None if session is None else session.riders.pop(rider, None)
            if held is None:
                return False
            self._by_rider.pop(held.token_hash, None)
            return True

    def lock(self, session_id: UUID, locked: bool) -> bool | None:
        """Lock or unlock the session's joins; the state now, or None when it is gone."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            session.locked = locked
            return locked

    def locked(self, session_id: UUID) -> bool | None:
        """Whether the session's joins are locked (the host's `lock_state`), or None."""
        with self._lock:
            session = self._sessions.get(session_id)
            return None if session is None else session.locked

    def new_join_code(self, session_id: UUID, now: float) -> str | None:
        """A new join code for the session, as shown; the earlier one finds nothing from now on,
        and the current control code ends, telling no one. None when the session is gone, or
        past its 10 an hour: then nothing changes, and the request is counted. A session past
        its lifetime ends, as in `host_session`, and gets no code."""
        with self._lock:
            session = self._sessions.get(session_id)
            ended = None if session is None else self._expired(session, now)
            if session is not None and ended is None:
                return self._new_join_code(session, now)
        self._expiry_told(ended)
        return None

    def _new_join_code(self, session: HeldSession, now: float) -> str | None:
        """`new_join_code` for a running session. Hold `_lock`."""
        if not session.join_codes.take(now):
            self.ignored["join_code_limit"] += 1
            return None
        code = self._new_code()
        del self._by_code[session.join_code]
        session.join_code = code
        self._by_code[code] = session.id
        session.code.end()
        return show_code(code)
