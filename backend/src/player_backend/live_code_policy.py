"""Pure rules for a live session's control code (ADR 0002, sections 8 and 10; ADR 0005, s. 3).

- The host asks for a code (`make_code`); a new one replaces the current one. 30 a session an
  hour; one more is refused and the current code stays as it was.
- A code works once, for 2 minutes. A right code while both controller places are held is
  `full`: not used up and not a wrong try.
- 5 wrong tries cancel the code (per session and code: a new code starts again at 0). With no
  current code there is nothing to guess: a try is wrong and counts nothing.
- The host's `drop` ends the current code; the host is sent nothing for that.
- Requests that name an unknown session (a join code that names none) are counted per address:
  60 a minute. Past that, every such request from the address is refused until its minute ends.

The code is held as its hash and compared in constant time. Times are seconds of one monotonic
clock, passed in. No I/O here.
"""

from __future__ import annotations

import hmac
import math
from dataclasses import dataclass
from typing import Final, Literal

from player_backend.live_limit_policy import Window

CODE_LIFETIME: Final = 120.0
WRONG_TRIES: Final = 5
CODES_PER_HOUR: Final = 30
UNKNOWN_PER_MINUTE: Final = 60
# Above this many addresses held, the unknown-code counts forget the ones whose minute is over.
_PRUNE_ABOVE: Final = 4096

# The contract's `code_cancelled` reasons (schema/live/v1/code-cancelled.schema.json).
type CancelReason = Literal["wrong_tries", "expired", "used", "replaced"]
# What a try of a code is: given a controller place, `full`, or `wrong`.
type Tried = Literal["right", "full", "wrong"]


@dataclass
class _Current:
    hash: bytes
    made_at: float
    wrong: int = 0


@dataclass(frozen=True)
class Try:
    outcome: Tried
    cancelled: CancelReason | None  # the code ended by this try (or had expired before it)


class ControlCode:
    """One session's control code: at most one current."""

    def __init__(self) -> None:
        self._current: _Current | None = None
        self._made = Window(CODES_PER_HOUR, 3600.0)

    def expire(self, now: float) -> bool:
        """End the current code if its 2 minutes are over by `now`: True when it ends now."""
        current = self._current
        if current is None or now - current.made_at < CODE_LIFETIME:
            return False
        self._current = None
        return True

    def make(self, hashed: bytes, now: float) -> tuple[bool, CancelReason | None]:
        """A new current code. (False, None) when over the hour's limit: nothing changes.
        Otherwise (True, how the earlier code ended now, if one was current)."""
        if not self._made.take(now):
            return False, None
        earlier: CancelReason | None = "expired" if self.expire(now) else None
        if self._current is not None:
            earlier = "replaced"
        self._current = _Current(hashed, now)
        return True, earlier

    def expires_in_ms(self, now: float) -> int:
        """What is left of the current code, in whole milliseconds (at least 1)."""
        current = self._current
        left = 0.0 if current is None else current.made_at + CODE_LIFETIME - now
        return max(1, min(int(CODE_LIFETIME * 1000), math.floor(left * 1000)))

    def tried(self, hashed: bytes, place_free: bool, now: float) -> Try:
        """Someone gave `hashed` for this session at `now`."""
        if self.expire(now):
            return Try("wrong", "expired")
        current = self._current
        if current is None:
            return Try("wrong", None)
        if hmac.compare_digest(current.hash, hashed):
            if not place_free:
                return Try("full", None)
            self._current = None
            return Try("right", "used")
        current.wrong += 1
        if current.wrong >= WRONG_TRIES:
            self._current = None
            return Try("wrong", "wrong_tries")
        return Try("wrong", None)

    def end(self) -> None:
        """The host's `drop` or `cancel_code`: the current code ends, and no one is told."""
        self._current = None


class UnknownSessions:
    """The per-address count of requests that name an unknown session. Keys are address
    hashes, never addresses. Fixed windows: a minute from an address's first count."""

    def __init__(self) -> None:
        self._held: dict[bytes, tuple[float, int]] = {}

    def refused_for(self, key: bytes, now: float) -> int | None:
        """Seconds until requests from `key` are taken again, or None when they are now."""
        held = self._held.get(key)
        if held is None or held[1] < UNKNOWN_PER_MINUTE or now - held[0] >= 60.0:
            return None
        return max(1, math.ceil(held[0] + 60.0 - now))

    def count(self, key: bytes, now: float) -> None:
        if len(self._held) > _PRUNE_ABOVE:
            self._held = {k: h for k, h in self._held.items() if now - h[0] < 60.0}
        held = self._held.get(key)
        if held is None or now - held[0] >= 60.0:
            self._held[key] = (now, 1)
        else:
            self._held[key] = (held[0], held[1] + 1)

    def held(self) -> int:
        return len(self._held)
