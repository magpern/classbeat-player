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
- `sweep`: the lifetimes.

A database error is logged by its type alone and never stops the caller.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from uuid import UUID

from player_backend.client_policy import ClientInfo
from player_backend.db import live
from player_backend.db.context import AccountContext
from player_backend.db.executor import DatabaseError, HandleClosed, Pool
from player_backend.live.registry import Ended, Registry, Started
from player_backend.live_session_policy import EndReason, audited

_log = logging.getLogger("player_backend.live")


def _logged(event: str, **fields: str) -> None:
    _log.info("live", extra={"fields": {"event": event, **fields}})


class LiveService:
    def __init__(
        self, registry: Registry, pool: Pool, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.registry = registry
        self.pool = pool
        self.clock = clock

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
        _logged("live.session_ended", reason=ended.reason)
        if not audited(ended.reason):
            return
        try:
            live.record_end(self.pool, ended.device_hash, ended.session_id, ended.reason)
        except (DatabaseError, HandleClosed) as error:
            _log.warning("live end not recorded", extra={"fields": {"error": type(error).__name__}})

    def sweep(self) -> None:
        for ended in self.registry.end_due(self.clock()):
            self._record(ended)

    def recheck(self, account_id: UUID | None = None) -> bool:
        """Re-check the sessions (of one account, or all). False: the database did not answer."""
        now = self.clock()
        running = self.registry.running(account_id)
        controllers = self.registry.signed_in_controllers(account_id)
        try:
            devices = live.devices_active(self.pool, [r.device_hash for r in running])
            sessions = live.sessions_active(self.pool, [c.site_session_hash for c in controllers])
        except (DatabaseError, HandleClosed) as error:
            _log.warning("live re-check failed", extra={"fields": {"error": type(error).__name__}})
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
