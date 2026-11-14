"""One live connection after its `hello`, and what is sent on it (ADR 0002, section 8).

Everything sent to a connection goes through its outbox, written by one task of its own, so a
phone that is slow to read never holds up the host's connection, or the other way round, and
frames never interleave. The outbox is bounded: a connection that does not read what it is sent
is closed (1008) instead of being queued for: what was queued is thrown away and its writer is
stopped, so a send that never completes holds nothing up. Any other close is the outbox's last
item: an `ended` queued before it goes out first. Runs on the event loop only.
"""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

from player_backend.live_limit_policy import OUTBOX_MAX, Window, messages_window
from player_backend.live_relay_policy import Outstanding
from player_backend.live_route_policy import Role
from player_backend.live_token_policy import Via
from player_backend.live_wire_policy import TOO_MANY


class Socket(Protocol):
    async def send_text(self, data: str) -> None: ...
    async def close(self, code: int = 1000, reason: str | None = None) -> None: ...


@dataclass(eq=False)
class Link:
    socket: Socket
    role: Role
    session_id: UUID
    slot: int | None = None  # a controller's place
    via: Via | None = None  # how a controller got its token
    rider: str | None = None  # a rider's id (never its token or nickname)
    token_hash: bytes | None = field(default=None, repr=False)  # a controller's token's hash
    messages: Window = field(default_factory=messages_window)  # what it may send
    outstanding: Outstanding = field(default_factory=Outstanding)  # a controller's commands
    writer: asyncio.Task[None] | None = None  # set by the connection that runs `write`
    _outbox: deque[str] = field(default_factory=deque[str], init=False)
    _close_code: int | None = field(default=None, init=False)
    _wake: asyncio.Event = field(default_factory=asyncio.Event, init=False)

    @property
    def closing(self) -> bool:
        return self._close_code is not None

    def put(self, text: str) -> None:
        """Queue one encoded message; nothing once the link is closing."""
        if self._close_code is not None:
            return
        if len(self._outbox) >= OUTBOX_MAX:
            self._outbox.clear()
            self.close(TOO_MANY)
            if self.writer is not None:
                self.writer.cancel()
            return
        self._outbox.append(text)
        self._wake.set()

    @property
    def close_code(self) -> int | None:
        return self._close_code

    def close(self, code: int) -> None:
        """Close after what is queued. The first close's code is the one sent."""
        if self._close_code is None:
            self._close_code = code
            self._wake.set()

    async def write(self) -> None:
        """The link's writer: until it has sent its close, or the socket fails."""
        while True:
            await self._wake.wait()
            self._wake.clear()
            while self._outbox:
                await self.socket.send_text(self._outbox.popleft())
            if self._close_code is not None:
                await self.socket.close(self._close_code)
                return
