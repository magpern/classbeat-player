"""What the live registry tells and answers (ADR 0002, section 8; ADR 0005, sections 2 and 3):
the ends, the drops, a start's answer and what the re-check and the WebSocket see. Plain
values; hashes are kept out of their `repr`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

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
