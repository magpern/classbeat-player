"""The hub's background work (live/hub.py): each task is held until it is done, so none is
collected while it runs, and a failure is logged by its type (`live.end_failed`: the host's
`end`, the one work spawned today). Runs on the event loop only.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

from player_backend.live.sender import logged


class Tasks:
    def __init__(self) -> None:
        self._held: set[asyncio.Task[object]] = set()

    def spawn(self, work: Coroutine[Any, Any, object]) -> None:
        task = asyncio.create_task(work)
        self._held.add(task)
        task.add_done_callback(self._done)

    def _done(self, task: asyncio.Task[object]) -> None:
        self._held.discard(task)
        error = None if task.cancelled() else task.exception()
        if error is not None:
            logged("live.end_failed", type(error).__name__, logging.ERROR)
