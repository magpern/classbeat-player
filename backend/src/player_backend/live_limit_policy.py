"""Pure rules for the live WebSocket's limits (ADR 0002, sections 8 and 10; ADR 0005, s. 5).

- `hello` must arrive within 5 seconds. Before it a connection may send one message of at most
  1 KiB; after it a message is at most 16 KiB and a connection may send 10 messages a second,
  the host's included. Breaking a limit closes the connection.
- Each controller may send at most 2 commands a second; the server answers more with `ack`
  `rate` itself, so at most 4 commands a second reach the host.
- Connections: 300 a minute per address, and 100 per address waiting for their `hello`. One
  connection per token is the hub's (a new one replaces the old). A session's own cap (63) is
  not reached in the companion part: one host token and at most 2 controller tokens exist.
- What the server has queued for one connection is bounded: a connection that does not read
  is closed rather than let the queue grow.

Times are seconds of one monotonic clock, passed in. No I/O here.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Final

HELLO_WITHIN: Final = 5.0
HELLO_MAX_BYTES: Final = 1024
MESSAGE_MAX_BYTES: Final = 16 * 1024
MESSAGES_PER_SECOND: Final = 10
COMMANDS_PER_SECOND: Final = 2
CONNECTIONS_PER_MINUTE: Final = 300  # per address
WAITING_FOR_HELLO: Final = 100  # per address
OUTBOX_MAX: Final = 64  # messages queued for one connection
# Above this many addresses held, the gate forgets the ones with nothing left to count.
_PRUNE_ABOVE: Final = 4096


class Window:
    """At most `limit` events in any `span` seconds. A refused event is not counted."""

    def __init__(self, limit: int, span: float) -> None:
        self._limit = limit
        self._span = span
        self._times: deque[float] = deque()

    def _forget(self, now: float) -> None:
        while self._times and self._times[0] <= now - self._span:
            self._times.popleft()

    def take(self, now: float) -> bool:
        self._forget(now)
        if len(self._times) >= self._limit:
            return False
        self._times.append(now)
        return True

    def idle(self, now: float) -> bool:
        self._forget(now)
        return not self._times


def messages_window() -> Window:
    return Window(MESSAGES_PER_SECOND, 1.0)


def commands_window() -> Window:
    return Window(COMMANDS_PER_SECOND, 1.0)


@dataclass
class _Address:
    opened: Window = field(default_factory=lambda: Window(CONNECTIONS_PER_MINUTE, 60.0))
    waiting: int = 0


class AddressGate:
    """The per-address connection limits. Keys are address hashes, never addresses."""

    def __init__(self) -> None:
        self._held: dict[bytes, _Address] = {}

    def admit(self, key: bytes, now: float) -> bool:
        """A new connection from `key`: admitted, and counted as waiting for its `hello`."""
        if len(self._held) > _PRUNE_ABOVE:
            self._prune(now)
        held = self._held.setdefault(key, _Address())
        if held.waiting >= WAITING_FOR_HELLO or not held.opened.take(now):
            return False
        held.waiting += 1
        return True

    def hello_over(self, key: bytes) -> None:
        """An admitted connection is no longer waiting: its `hello` came, or it was closed."""
        held = self._held.get(key)
        if held is not None and held.waiting > 0:
            held.waiting -= 1

    def _prune(self, now: float) -> None:
        for key in [k for k, a in self._held.items() if a.waiting == 0 and a.opened.idle(now)]:
            del self._held[key]

    def held(self) -> int:
        return len(self._held)


def too_big(size: int, after_hello: bool) -> bool:
    """Whether a message of `size` UTF-8 bytes breaks the size limit."""
    return size > (MESSAGE_MAX_BYTES if after_hello else HELLO_MAX_BYTES)
