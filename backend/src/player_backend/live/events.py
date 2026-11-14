"""What the live registry tells and answers (ADR 0002, section 8; ADR 0005, sections 2 and 3;
ADR 0007, sections 2 and 3): the ends, the drops, a start's answer, the control codes and
controllers given out, the riders' joins and connections, and what the re-check and the
WebSocket see. Plain values; hashes and nicknames are kept out of their `repr`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from player_backend.live_code_policy import CancelReason
from player_backend.live_session_policy import EndReason
from player_backend.live_token_policy import Via

# Why a controller's token ended while its session goes on (ADR 0005 section 10, amended
# 2026-11-14): the host's `drop`, or the end of its site session (sign-in tokens only).
type DropReason = Literal["dropped", "session_ended"]


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
    """A controller dropped from a session that goes on. Its connection, if any, is closed with
    4403, and the host is told `controller_left` with `reason` and `via`, connected or not.
    `reason`: `dropped` by the host, `session_ended` with its site session (the re-check).
    `token_hash`: the dropped token's, so a later holder of the place is never taken for it."""

    session_id: UUID
    slot: int
    reason: DropReason
    via: Via
    token_hash: bytes = field(repr=False)


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


@dataclass(frozen=True)
class Seat:
    """The place a controller token holds: its session, its slot, how it was got, and the
    token's hash (its connection is matched by it when a drop reaches the hub)."""

    session_id: UUID
    slot: int
    via: Via
    token_hash: bytes = field(repr=False)


@dataclass(frozen=True)
class CodeCancelled:
    """A session's control code ended by use, expiry, wrong tries (or a newer code). The host
    is told `code_cancelled`; a `drop` ends the code without this."""

    session_id: UUID
    reason: CancelReason


@dataclass(frozen=True)
class MadeCode:
    code: str = field(repr=False)  # as shown: XXXX-XXXX; sent to the host only
    expires_in_ms: int
    earlier: CancelReason | None  # how the earlier code ended, if one was current


@dataclass(frozen=True)
class Granted:
    """A controller token given out, once, here. `device_hash` is for the audit event."""

    session_id: UUID
    slot: int
    token: str = field(repr=False)
    device_hash: bytes = field(repr=False)


# What a control-code exchange came to: no such session, a wrong code, both places held.
type Refusal = Literal["unknown", "wrong", "full"]


@dataclass(frozen=True)
class Exchange:
    """The answer of `POST /api/live/control`: a token, or why not; and what it cancelled."""

    granted: Granted | None
    refusal: Refusal | None
    cancelled: CodeCancelled | None
    device_hash: bytes = field(repr=False)  # the session's, for the audit event (or empty)


# Why a join got no rider token: no session has the code (an earlier code included), or the
# session refused it (locked, full, or over its joins a minute). Both are `cannot_join`.
type JoinRefusal = Literal["unknown", "refused"]


# Why the host's `new_join_code` got no code: its session is gone (or has just ended, past its
# lifetime), or it is past its 10 an hour (ADR 0007, section 3). Each is the hub's drop label.
type JoinCodeRefusal = Literal["session_gone", "join_code_limit"]


@dataclass(frozen=True)
class NoJoinCode:
    """The host's `new_join_code` made no code: `reason` says why."""

    reason: JoinCodeRefusal


@dataclass(frozen=True)
class RiderSeat:
    """A rider token's connection, counted (ADR 0007, section 2): its session, its rider id
    and nickname (for the host's `rider_joined`), and whether it is the token's only open
    connection, so the host is told (a new connection replacing the old one tells nothing)."""

    session_id: UUID
    rider: str
    nickname: str = field(repr=False)
    announced: bool


@dataclass(frozen=True)
class RiderIn:
    """A rider connected now, for the host's list (`rider_joined`), in the order they joined."""

    rider: str
    nickname: str = field(repr=False)
