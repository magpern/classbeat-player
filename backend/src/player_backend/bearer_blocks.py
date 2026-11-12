"""What this process remembers about bearer tokens that are refused without a lookup.

ADR 0002, section 10: the same unknown or revoked token from one address, 20 times in 5
minutes, is then refused for 5 minutes without a lookup. The count is the shared counter in
the database (`rate_limit_hit`), which can only be counted, not read. So the process that sees
the counter go over its limit remembers the refusal here, by the counter's key (a hash of the
token's hash and the address's hash, never a token), and answers from memory until it ends.

Each process learns of a refusal at its own first lookup after the limit: with several
processes a refused token costs at most one more lookup per process. Memory is bounded: when
full, ended entries go first, then the ones that end soonest.
"""

from __future__ import annotations

import math
import threading
from typing import Final

CAPACITY: Final = 10_000


class BearerBlocks:
    def __init__(self, capacity: int = CAPACITY) -> None:
        self._capacity = capacity
        self._until: dict[bytes, float] = {}
        self._lock = threading.Lock()

    def seconds_left(self, key: bytes, now: float) -> int | None:
        """How long `key` is still refused (at least 1 second), or None when it is not."""
        with self._lock:
            until = self._until.get(key)
            if until is None:
                return None
            if until <= now:
                del self._until[key]
                return None
            return max(1, math.ceil(until - now))

    def block(self, key: bytes, until: float, now: float) -> None:
        """Refuse `key` until `until`."""
        with self._lock:
            if key not in self._until and len(self._until) >= self._capacity:
                for ended in [k for k, end in self._until.items() if end <= now]:
                    del self._until[ended]
                while len(self._until) >= self._capacity:
                    del self._until[min(self._until, key=self._until.__getitem__)]
            self._until[key] = max(until, self._until.get(key, until))

    def __len__(self) -> int:
        with self._lock:
            return len(self._until)
