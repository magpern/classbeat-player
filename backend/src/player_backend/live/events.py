"""What the live registry tells and answers (ADR 0002, section 8; ADR 0005, sections 2 and 3):
the ends, the drops, a start's answer, the control codes and controllers given out, and what
the re-check and the WebSocket see. Plain
values; hashes are kept out of their `repr`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from player_backend.live_code_policy import CancelReason
from player_backend.live_session_policy import EndReason
from player_backend.live_token_policy import Via


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


@dataclass(frozen=True)
class Seat:
    """The place a controller token holds: its session, its slot and how it was got."""

    session_id: UUID
    slot: int
    via: Via


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
