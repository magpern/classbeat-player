"""Data access of the live process (ADR 0002, sections 8, 9 and 11; ADR 0005, section 2).

The live process reads the database as `player_app` only through the functions of section 9:

- the re-check: `auth_device_active` for each session's device token hash and
  `auth_session_active` for each controller got by sign-in, many hashes in one statement;
- the audit events "live session started" and "ended", "controller added" and "control code
  cancelled" (after wrong tries): started in the transaction of the device-token request that
  started it, a controller added by sign-in in the transaction of the site session that asked;
  the others in a transaction of their own that first calls `auth_enter_device` with the
  session's stored hash. When the device no longer works that sets no account, and nothing is
  written (the site's own event is the record then);
- the listening connection, a connection of its own (executor/_listen.py).

No token, code or hash is in an event's detail: the session's id, why it ended, how a
controller was added or why a code was cancelled.
"""

from __future__ import annotations

import json
from collections.abc import Generator, Sequence
from contextlib import contextmanager
from uuid import UUID

from player_backend.client_policy import ClientInfo
from player_backend.db.context import AccountContext
from player_backend.db.executor import Listener, Pool, Row, listen
from player_backend.db.queries import devices as dq
from player_backend.db.queries import live as q

# Section 11.
STARTED = "live.session_started"
ENDED = "live.session_ended"
CONTROLLER_ADDED = "live.controller_added"
CODE_CANCELLED = "live.control_code_cancelled"


def add_event(
    ctx: AccountContext,
    event: str,
    session_id: UUID,
    client: ClientInfo,
    reason: str | None = None,
    via: str | None = None,
) -> None:
    """Write a live session's event in the request's transaction (a device-token request, or
    the site session that asked for a controller)."""
    detail: dict[str, str] = {"session_id": str(session_id)}
    if reason is not None:
        detail["reason"] = reason
    if via is not None:
        detail["via"] = via
    ctx.db.rows(
        dq.ADD_DEVICE_EVENT,
        (
            ctx.account_id,
            event,
            ctx.credential_kind,
            ctx.credential_id,
            client.network,
            client.family,
            json.dumps(detail),
        ),
    )


# What `record_end` answers when the event was written; otherwise the device's state.
RECORDED = "recorded"


def record_end(pool: Pool, device_hash: bytes, session_id: UUID, reason: str) -> str:
    """Write "live session ended" after `auth_enter_device` with the session's stored hash."""
    return record_event(pool, device_hash, ENDED, {"session_id": str(session_id), "reason": reason})


def record_event(
    pool: Pool,
    device_hash: bytes,
    event: str,
    detail: dict[str, str],
    client: ClientInfo | None = None,
) -> str:
    """Write a live session's event after `auth_enter_device` with the session's stored hash.

    `RECORDED` when written. Otherwise nothing is written and the answer is the device's state
    from `auth_enter_device` (`revoked`, `expired`, `unknown`, or `limited` when over its
    budget): that sets no account.
    """
    with pool.handle() as db, db.transaction():
        db.rows(dq.DEVICE_BUDGET, ("requests",))
        found = db.rows(dq.ENTER_DEVICE, (device_hash,))
        account_id, _ = db.rows(dq.CURRENT_ACCOUNT)[0]
        device_id, state = found[0] if len(found) == 1 else (None, "unknown")
        if state != "ok" or not isinstance(account_id, UUID) or not isinstance(device_id, UUID):
            return str(state)
        db.rows(
            dq.ADD_DEVICE_EVENT,
            (
                account_id,
                event,
                "device",
                device_id,
                None if client is None else client.network,
                "" if client is None else client.family,
                json.dumps(detail),
            ),
        )
        return RECORDED


def _answers(rows: list[Row]) -> dict[bytes, bool]:
    # bytea comes back as bytes; anything else is no answer, and so not active.
    return {h: active is True for h, active in rows if isinstance(h, bytes)}


def devices_active(pool: Pool, hashes: Sequence[bytes]) -> dict[bytes, bool]:
    """For each device token hash, whether the token still works (`auth_device_active`)."""
    if not hashes:
        return {}
    with pool.handle() as db:
        return _answers(db.rows(q.DEVICES_ACTIVE, (list(hashes),)))


def sessions_active(pool: Pool, hashes: Sequence[bytes]) -> dict[bytes, bool]:
    """For each site session token hash, whether it still works (`auth_session_active`)."""
    if not hashes:
        return {}
    with pool.handle() as db:
        return _answers(db.rows(q.SESSIONS_ACTIVE, (list(hashes),)))


@contextmanager
def listening(conninfo: str) -> Generator[Listener]:
    """The live process's own connection, listening on `live_revocations`."""
    with listen(conninfo) as (db, listener):
        db.rows(q.LISTEN)
        yield listener
