"""classbeat's key set, fetched and cached (ADR 0010, section 3, "Endpoints and keys").

Fetched at start and kept at most 24 hours. A token naming a `kid` the cache does not hold
triggers one fetch, at most once every 5 minutes. A failed fetch keeps the cached keys until they
are 24 hours old; after that no key is held and every token is refused until a fetch succeeds.
The fetch itself is handed in (classbeat_http.py in production, a fake in the tests).
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable, Sequence
from typing import Final, cast

from player_backend.classbeat_policy import Json

KEEP_FOR: Final = 24 * 60 * 60
REFETCH_EVERY: Final = 5 * 60


class KeySetError(ValueError):
    """The key set could not be fetched or read. Carries no content."""


def parse_key_set(body: bytes) -> tuple[Json, ...]:
    """The keys of a JWK set document: `{"keys": [ {...}, ... ]}`, objects only."""
    try:
        document: object = json.loads(body)
    except (UnicodeDecodeError, ValueError):
        raise KeySetError("the key set is not JSON") from None
    if not isinstance(document, dict):
        raise KeySetError("the key set is not an object")
    keys = cast(dict[str, object], document).get("keys")
    if not isinstance(keys, list):
        raise KeySetError("the key set has no keys")
    entries = cast(list[object], keys)
    return tuple(cast(Json, key) for key in entries if isinstance(key, dict))


class KeySet:
    """The cached keys. Safe to share between the request threads."""

    def __init__(
        self, fetch: Callable[[], bytes], clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._fetch = fetch
        self._clock = clock
        self._lock = threading.Lock()
        self._keys: tuple[Json, ...] = ()
        self._fetched_at: float | None = None
        self._tried_at: float | None = None

    def refresh(self) -> bool:
        """Fetch now (at start). False when the fetch failed; the cache is kept as it was."""
        with self._lock:
            return self._refresh_locked()

    def _refresh_locked(self) -> bool:
        now = self._clock()
        self._tried_at = now
        try:
            keys = parse_key_set(self._fetch())
        except Exception:  # Any failure keeps what is cached. Nothing of it is logged.
            return False
        self._keys, self._fetched_at = keys, now
        return True

    def _expired(self, now: float) -> bool:
        return self._fetched_at is None or now - self._fetched_at >= KEEP_FOR

    def _may_try(self, now: float) -> bool:
        return self._tried_at is None or now - self._tried_at >= REFETCH_EVERY

    def keys_for(self, kid: str) -> Sequence[Json]:
        """The keys to look `kid` up in, fetching again when the rules above allow it."""
        with self._lock:
            now = self._clock()
            known = any(key.get("kid") == kid for key in self._keys)
            if (self._expired(now) or not known) and self._may_try(now):
                self._refresh_locked()
                now = self._clock()
            if self._expired(now):
                self._keys, self._fetched_at = (), None
            return self._keys
