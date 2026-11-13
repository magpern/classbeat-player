"""The live sessions' edge: the registry in memory and what the database is asked and told
(ADR 0002, section 8; ADR 0005, sections 2 and 6).

- `start`: in a device-token request's transaction. The device's earlier session ends, the new
  one starts, and both events are written in that transaction. If writing fails, the new
  session is taken back, so no host token is held that was never given out.
- `end`: the host's `end`, or any other end by the rules. The event is written after
  `auth_enter_device` with the session's stored hash, except for a revoked device.
- `recheck`: `auth_device_active` for every running session (or one account's) and
  `auth_session_active` for every controller got by sign-in. Not active: the session ends
  (`revoked`), or that controller is dropped. A re-check the database does not answer changes
  nothing; the sweep ends a session left unconfirmed too long (live_session_policy.py).
- `sweep`: the lifetimes, of the sessions and of their control codes.
- `by_sign_in` and `by_code`: a controller for `POST /api/live/controller` and
  `POST /api/live/control`. "Controller added" by sign-in is written in the site session's
  transaction (taken back if writing fails); by a code, and "control code cancelled" after wrong
  tries, after `auth_enter_device` with the session's stored hash. A join code that names no
  session is counted for the caller's address (live_code_policy.py, `UnknownSessions`).

A database error is logged by its type alone and never stops the caller. Logs name an event, an
error type, an end reason or a device state, never a token, code or hash; the log formatter
keeps only its allowed fields, so those values are in the message.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from uuid import UUID

from player_backend.client_policy import ClientInfo
from player_backend.db import live
from player_backend.db.context import AccountContext
from player_backend.db.executor import DatabaseError, HandleClosed, Pool
from player_backend.live.events import Exchange, Granted
from player_backend.live.registry import Ended, Registry, Started
from player_backend.live_code_policy import UnknownSessions
from player_backend.live_session_policy import EndReason, audited

_log = logging.getLogger("player_backend.live")


def _logged(event: str, detail: str = "-", level: int = logging.INFO) -> None:
    """`detail` is a fixed word: an end reason, a device state or an error's type."""
    _log.log(level, "live: %s", detail, extra={"fields": {"event": event}})


class LiveService:
    def __init__(
        self, registry: Registry, pool: Pool, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.registry = registry
        self.pool = pool
        self.clock = clock
        self._unknown = UnknownSessions()
        self._unknown_lock = threading.Lock()

    def start(self, ctx: AccountContext, device_hash: bytes, client: ClientInfo) -> Started | None:
        """Start a session for the request's device; None when the account has 3 elsewhere."""
        started = self.registry.start(ctx.account_id, ctx.credential_id, device_hash, self.clock())
        if started is None:
            return None
        try:
            for ended in started.replaced:
                live.add_event(ctx, live.ENDED, ended.session_id, client, ended.reason)
            live.add_event(ctx, live.STARTED, started.session_id, client)
        except BaseException:
            self.registry.discard(started.session_id)
            raise
        _logged("live.session_started")
        return started

    def end(self, session_id: UUID, reason: EndReason) -> bool:
        ended = self.registry.end(session_id, reason)
        if ended is not None:
            self._record(ended)
        return ended is not None

    def _record(self, ended: Ended) -> None:
        _logged("live.session_ended", ended.reason)
        if not audited(ended.reason):
            return
        try:
            state = live.record_end(self.pool, ended.device_hash, ended.session_id, ended.reason)
        except (DatabaseError, HandleClosed) as error:
            _logged("live.end_not_recorded", type(error).__name__, logging.WARNING)
            return
        if state != live.RECORDED:
            # Over its budget (`limited`), or no longer working: the end has no audit event.
            _logged("live.end_not_recorded", state, logging.WARNING)

    def sweep(self) -> None:
        now = self.clock()
        for ended in self.registry.end_due(now):
            self._record(ended)
        self.registry.codes_due(now)

    # -- becoming a controller ------------------------------------------------------------

    def refused_for(self, address_hash: bytes) -> int | None:
        """Seconds until this address is taken again after too many unknown join codes."""
        with self._unknown_lock:
            return self._unknown.refused_for(address_hash, self.clock())

    def _unknown_session(self, address_hash: bytes) -> None:
        with self._unknown_lock:
            self._unknown.count(address_hash, self.clock())

    def by_sign_in(
        self,
        ctx: AccountContext,
        raw_session: object,
        site_hash: bytes,
        address_hash: bytes,
        client: ClientInfo,
    ) -> Granted | None:
        """A controller for a sign-in of the session's own account, or None (`cannot_control`)."""
        session_id = self.registry.session_of_code(raw_session)
        if session_id is None:
            self._unknown_session(address_hash)
            return None
        granted = self.registry.sign_in_controller(session_id, ctx.account_id, site_hash)
        if granted is None:
            return None
        try:
            live.add_event(ctx, live.CONTROLLER_ADDED, session_id, client, via="sign_in")
        except BaseException:
            self.registry.drop_controller(session_id, granted.slot, site_hash)
            raise
        _logged("live.controller_added", "sign_in")
        return granted

    def by_code(
        self, raw_session: object, raw_code: object, address_hash: bytes, client: ClientInfo
    ) -> Exchange:
        exchanged = self.registry.exchange(raw_session, raw_code, self.clock())
        if exchanged.refusal == "unknown":
            self._unknown_session(address_hash)
        cancelled = exchanged.cancelled
        if cancelled is not None and cancelled.reason == "wrong_tries":
            detail = {"session_id": str(cancelled.session_id), "reason": "wrong_tries"}
            self._event(exchanged.device_hash, live.CODE_CANCELLED, detail, client)
        granted = exchanged.granted
        if granted is not None:
            detail = {"session_id": str(granted.session_id), "via": "code"}
            self._event(exchanged.device_hash, live.CONTROLLER_ADDED, detail, client)
        return exchanged

    def _event(
        self, device_hash: bytes, event: str, detail: dict[str, str], client: ClientInfo
    ) -> None:
        _logged(event, detail.get("reason") or detail.get("via") or "-")
        try:
            state = live.record_event(self.pool, device_hash, event, detail, client)
        except (DatabaseError, HandleClosed) as error:
            _logged("live.event_not_recorded", type(error).__name__, logging.WARNING)
            return
        if state != live.RECORDED:
            _logged("live.event_not_recorded", state, logging.WARNING)

    def recheck(self, account_id: UUID | None = None) -> bool:
        """Re-check the sessions (of one account, or all). False: the database did not answer."""
        now = self.clock()
        running = self.registry.running(account_id)
        controllers = self.registry.signed_in_controllers(account_id)
        try:
            devices = live.devices_active(self.pool, [r.device_hash for r in running])
            sessions = live.sessions_active(self.pool, [c.site_session_hash for c in controllers])
        except (DatabaseError, HandleClosed) as error:
            _logged("live.recheck_failed", type(error).__name__, logging.WARNING)
            return False
        # Only a plain "active" keeps a session; a hash with no answer ends it too.
        active = [r.session_id for r in running if devices.get(r.device_hash) is True]
        self.registry.confirm(active, now)
        for r in running:
            if devices.get(r.device_hash) is not True:
                self.end(r.session_id, "revoked")
        for c in controllers:
            if sessions.get(c.site_session_hash) is not True:
                self.registry.drop_controller(c.session_id, c.slot, c.site_session_hash)
        return True
