"""Who the live registry tells of what happens to its sessions (live/registry.py).

A watcher is called for every session that ends, every controller that is dropped and every
control code that is cancelled, after the registry's lock is released, on the caller's thread:
a watcher that touches an event loop hands its work over to that loop. A watcher that raises is
logged by its error type and the others are still told of every event, so the caller (and its
audit event) goes on.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Sequence

from player_backend.live.events import CodeCancelled, Dropped, Ended

_log = logging.getLogger("player_backend.live")

type Event = Ended | Dropped | CodeCancelled
type Watcher = Callable[[Event], None]


class Watchers:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._watchers: list[Watcher] = []

    def add(self, watcher: Watcher) -> None:
        with self._lock:
            self._watchers.append(watcher)

    def tell(self, events: Sequence[Event]) -> None:
        with self._lock:
            watchers = list(self._watchers)
        for event in events:
            for watcher in watchers:
                try:
                    watcher(event)
                except Exception as error:  # one watcher must not cost the others or the caller
                    _log.error(
                        "live watcher error: %s",
                        type(error).__name__,
                        extra={"fields": {"event": "live.watcher_failed"}},
                    )
