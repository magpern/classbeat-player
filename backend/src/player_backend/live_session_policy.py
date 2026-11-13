"""Pure rules of a live session's life (ADR 0002, section 8; ADR 0005, sections 2 and 6).

- One live session per device: a device that starts a session first ends its earlier one.
- At most 3 per account; a fourth start on another device is refused (`sessions_full`, 409).
- A session ends 15 minutes after its host connection is lost (or after it started, when the
  host never connected), and 12 hours after it started at the latest.
- The re-check runs every 30 seconds. A session the re-check could not confirm for 3 rounds in
  a row (the database did not answer) is ended: when the live process cannot tell whether a
  device still works, it fails closed. Only the phone remote ends; the class goes on.
- What ended a session is told to its connections with one of the contract's `ended` reasons,
  and written as an audit event except when the device was revoked (the site's own event, in the
  revoking transaction, is the record then).

Times are seconds of one monotonic clock, passed in. No I/O here.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final, Literal
from uuid import UUID

SESSIONS_PER_ACCOUNT: Final = 3
HOST_AWAY_LIMIT: Final = 15 * 60.0
LIFETIME_LIMIT: Final = 12 * 3600.0
RECHECK_EVERY: Final = 30.0
UNCONFIRMED_LIMIT: Final = 3 * RECHECK_EVERY
# The listening connection is opened again after 1, 2, 4, 8, then every 15 seconds.
LISTEN_RETRY_MAX: Final = 15.0

type EndReason = Literal[
    "host_ended",  # the host sent `end`
    "replaced",  # its device started a new session
    "host_away",  # 15 minutes without a host connection
    "lifetime",  # 12 hours
    "revoked",  # the re-check: the device token no longer works (revoked, expired, account gone)
    "unconfirmed",  # the re-check could not be answered for UNCONFIRMED_LIMIT
]
# The `reason` of the contract's `ended` message (schema/live/v1/ended.schema.json).
type WireReason = Literal["host_ended", "revoked", "expired", "dropped"]

_WIRE: Final[dict[EndReason, WireReason]] = {
    "host_ended": "host_ended",
    "replaced": "host_ended",
    "host_away": "expired",
    "lifetime": "expired",
    "revoked": "revoked",
    "unconfirmed": "expired",
}


def wire_reason(reason: EndReason) -> WireReason:
    """What the session's connections are told before they are closed with 4403."""
    return _WIRE[reason]


def audited(reason: EndReason) -> bool:
    """Whether the end is written as `live.session_ended` (after `auth_enter_device`)."""
    return reason != "revoked"


@dataclass(frozen=True)
class Held:
    """A running session, as the start rule sees it."""

    session_id: UUID
    account_id: UUID
    device_id: UUID


@dataclass(frozen=True)
class StartPlan:
    """What a start does: the earlier sessions of the device it ends, or that it is refused."""

    replaced: tuple[UUID, ...]
    full: bool


def plan_start(running: Iterable[Held], account_id: UUID, device_id: UUID) -> StartPlan:
    """The start of a session by `device_id` of `account_id`, given the running sessions."""
    mine = [held for held in running if held.account_id == account_id]
    replaced = tuple(held.session_id for held in mine if held.device_id == device_id)
    others = sum(1 for held in mine if held.device_id != device_id)
    if others >= SESSIONS_PER_ACCOUNT:
        return StartPlan(replaced=(), full=True)
    return StartPlan(replaced=replaced, full=False)


@dataclass(frozen=True)
class Clocks:
    """A session's times: started, host away since (None while connected), last confirmed."""

    started_at: float
    host_away_since: float | None
    confirmed_at: float


def expiry(clocks: Clocks, now: float) -> EndReason | None:
    """Why the session has ended by `now` by its lifetimes, or None while it runs."""
    if now - clocks.started_at >= LIFETIME_LIMIT:
        return "lifetime"
    if clocks.host_away_since is not None and now - clocks.host_away_since >= HOST_AWAY_LIMIT:
        return "host_away"
    if now - clocks.confirmed_at >= UNCONFIRMED_LIMIT:
        return "unconfirmed"
    return None


def listen_retry_after(failures: int) -> float:
    """Seconds before the listening connection is opened again after `failures` in a row."""
    return min(LISTEN_RETRY_MAX, 2.0 ** max(0, failures - 1))


def notice_account(payload: str) -> UUID | None:
    """The account a `live_revocations` notice names, or None when it names none."""
    try:
        return UUID(payload)
    except ValueError:
        return None
