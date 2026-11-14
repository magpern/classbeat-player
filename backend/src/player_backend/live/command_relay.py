"""The controllers' commands and the host's answers on the live WebSocket (ADR 0005, sections 4
and 5; live_relay_policy.py), for the hub (live/hub.py).

- A controller's `command` goes to the host with the slot the server gave it, within 2 a second
  per slot; a command for a host that is away is answered `host_away` at once and kept nowhere.
- Each command id a controller's connection sent is answered once, with `ack`: the host's
  `command_result` for an id that connection sent and has had no answer to, else it is dropped
  as `unmatched_result`: the same id sent twice gets one `ack` (the host's answer to the
  second, `duplicate`, is dropped); a phone never resends by itself (ADR 0005, section 5).
  A host that leaves takes its unanswered commands with it (the hub gives
  each phone a new `Outstanding`).

Runs on the event loop only.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from player_backend.live.link import Link
from player_backend.live.sender import Sender
from player_backend.live_limit_policy import Window, commands_window
from player_backend.live_relay_policy import Answer, ack_of, on_command
from player_backend.live_wire_policy import Message


class CommandRelay:
    def __init__(self, sender: Sender, clock: Callable[[], float]) -> None:
        self._sender = sender
        self._clock = clock
        self._windows: dict[tuple[UUID, int], Window] = {}  # each slot's commands a second

    def command(self, link: Link, host: Link | None, message: Message) -> None:
        if link.slot is None:  # not reached: only a controller's command has a route
            return self._sender.drop(link, "not_from_role")
        window = self._windows.setdefault((link.session_id, link.slot), commands_window())
        outcome = on_command(message, link.slot, window.take(self._clock()), host is not None)
        if isinstance(outcome, Answer) or host is None:
            return self._sender.send_one(link, outcome.message)
        link.outstanding.add(str(message["id"]))
        self._sender.send_one(host, outcome.message)

    def result(self, link: Link, phone: Link | None, message: Message) -> None:
        """The host's `command_result`, for the phone in the slot it names (or none)."""
        if phone is None or not phone.outstanding.answer(str(message["id"])):
            return self._sender.drop(link, "unmatched_result")
        self._sender.send_one(phone, ack_of(message))

    def forget(self, session_id: UUID, slots: tuple[int, ...]) -> None:
        for slot in slots:
            self._windows.pop((session_id, slot), None)
