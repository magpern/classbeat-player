"""The host's control code on the live WebSocket (ADR 0005, section 3; ADR 0002, section 8),
for the hub (live/hub.py). The code's rules are live_code_policy.py's and its state is the
registry's (live/controllers.py); this module tells the host.

- The host's `make_code` gets `control_code`, to the host's connection only, after
  `code_cancelled` `replaced` (or `expired`) for the code it replaces. One that makes no code
  is dropped and counted by why: `code_limit` over 30 an hour (the current code stays), or
  `session_gone` for a session that is gone or past its lifetime (which ends it). So
  `code_limit` counts only the requests the limit refused (#407).
- A code used, run out or cancelled by wrong tries is told to the host as `code_cancelled` (a
  watcher's event), if the host is connected.
- The host's `cancel_code` ends the current code alone, telling no one.

Nothing here is logged but a drop's reason. Runs on the event loop only.
"""

from __future__ import annotations

from collections.abc import Callable

from player_backend.live.events import CodeCancelled, NoControlCode
from player_backend.live.link import Link
from player_backend.live.registry import Registry
from player_backend.live.sender import Sender
from player_backend.live_wire_policy import code_cancelled, control_code


class CodeRole:
    def __init__(self, registry: Registry, sender: Sender, clock: Callable[[], float]) -> None:
        self._registry = registry
        self._sender = sender
        self._clock = clock

    def make(self, host: Link) -> None:
        made = self._registry.make_code(host.session_id, self._clock())
        if isinstance(made, NoControlCode):
            return self._sender.drop(host, made.reason)
        if made.earlier is not None:
            self._sender.send_one(host, code_cancelled(made.earlier))
        self._sender.send_one(host, control_code(made.code, made.expires_in_ms))

    def cancel(self, host: Link) -> None:
        self._registry.end_code(host.session_id)  # the host is sent nothing for it

    def cancelled(self, host: Link | None, event: CodeCancelled) -> None:
        if host is not None:
            self._sender.send_one(host, code_cancelled(event.reason))
