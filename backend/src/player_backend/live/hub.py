"""The live connections of every session, and the router between them (ADR 0002, section 8;
ADR 0005, sections 1 and 3 to 6).

- One connection per token: a new host connection, or a controller's with the same token,
  replaces the old one, which is closed with 4409.
- The host is told `welcome`, then `controller_joined` for each phone connected; a controller
  is told `welcome` with its slot and whether the host is in. Controllers get `host_status`
  when the host comes and goes, and nothing else while it is away; the host gets
  `controller_joined` and `controller_left` as phones come and go.
- Every message after `hello` is routed by the allowlist (live_route_policy.py), checked with
  its schema for its sender's role; anything else is dropped and counted in `dropped`. Every
  message the hub sends is checked against the allowlist and its schema for the receiver's
  role first; one that fails is not sent (counted in `refused`).
- Commands and their answers follow live_relay_policy.py. A command for a host that is away is
  answered `host_away` at once and kept nowhere. Each command id a controller's connection
  sent is answered once: the same id sent twice gets one `ack` (the host's answer to the second,
  `duplicate`, is dropped as `unmatched_result`); a phone never resends by itself (ADR 0005,
  section 5). A host that leaves takes its unanswered commands with it: their answers from a
  returning host reach no one.
- A session that ends, or a controller that is dropped (the registry's watchers, called on any
  thread: the re-check's, a route's, the event loop's), gets `ended` and is closed with 4403.
- The host's `make_code` gets `control_code`, to the host's connection only, after
  `code_cancelled` `replaced` (or `expired`) for the code it replaces; over 30 an hour it is
  dropped and counted (`code_limit`), and the current code stays. A code used, run out or
  cancelled by wrong tries is told to the host as `code_cancelled` (a watcher's event). The
  host's `drop` ends the current code, telling no one, and drops the slot's controller.

Threads: the hub's state is touched on the event loop only. The watcher hands each event over
with `call_soon_threadsafe` and logs a failure by its type. The loop is bound by `bind`, which
each connection calls before it looks its token up: a watcher that finds no loop bound was
called after its session or controller left the registry and before any lookup that could find
it, so it has nothing to close.
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from collections.abc import Coroutine
from typing import Any
from uuid import UUID

from player_backend.live.events import CodeCancelled, Dropped, Ended, Seat
from player_backend.live.link import Link, Socket
from player_backend.live.schemas import routes, valid
from player_backend.live.service import LiveService
from player_backend.live.watchers import Event
from player_backend.live_limit_policy import HELLO_WITHIN, AddressGate, Window, commands_window
from player_backend.live_relay_policy import Answer, Outstanding, ack_of, on_command
from player_backend.live_route_policy import inbound, outbound
from player_backend.live_session_policy import wire_reason
from player_backend.live_wire_policy import (
    ENDED,
    REPLACED,
    Message,
    code_cancelled,
    control_code,
    controller_joined,
    controller_left,
    decode,
    encode,
    ended,
    host_status,
    welcome_controller,
    welcome_host,
)

_log = logging.getLogger("player_backend.live")


def _logged(event: str, detail: str, level: int = logging.INFO) -> None:
    """`detail` is a fixed word: a role, a drop reason, a message type or an error's type."""
    _log.log(level, "live: %s", detail, extra={"fields": {"event": event}})


class Hub:
    def __init__(self, service: LiveService, hello_within: float = HELLO_WITHIN) -> None:
        self.service = service
        self.hello_within = hello_within  # how long a connection has for its `hello`
        self.gate = AddressGate()  # the per-address connection limits
        self.dropped: Counter[str] = Counter()  # messages dropped, by reason
        self.refused: Counter[str] = Counter()  # messages the hub would not send, by type
        self._loop: asyncio.AbstractEventLoop | None = None
        self._hosts: dict[UUID, Link] = {}
        self._controllers: dict[UUID, dict[int, Link]] = {}
        self._commands: dict[tuple[UUID, int], Window] = {}
        self._tasks: set[asyncio.Task[object]] = set()
        service.registry.watch(self._watch)

    # -- the event loop and the registry's events --------------------------------------------

    def bind(self) -> None:
        """Bind the hub to the running loop. Called before any token is looked up."""
        loop = asyncio.get_running_loop()
        if self._loop is None:
            self._loop = loop
        elif self._loop is not loop:
            raise RuntimeError("the live hub runs on one event loop")

    def _watch(self, event: Event) -> None:
        loop = self._loop
        if loop is None:
            return
        try:
            loop.call_soon_threadsafe(self._guarded, event)
        except RuntimeError as error:  # the loop is closed: the process is stopping
            _logged("live.event_lost", type(error).__name__, logging.WARNING)

    def _guarded(self, event: Event) -> None:
        try:
            if isinstance(event, Ended):
                self._ended(event)
            elif isinstance(event, Dropped):
                self._dropped(event)
            else:
                self._cancelled(event)
        except Exception as error:  # one event must not cost the loop or the next event
            _logged("live.event_failed", type(error).__name__, logging.ERROR)

    def _ended(self, event: Ended) -> None:
        links = list(self._controllers.pop(event.session_id, {}).values())
        host = self._hosts.pop(event.session_id, None)
        links += [host] if host is not None else []
        for slot in (1, 2):
            self._commands.pop((event.session_id, slot), None)
        for link in links:
            self._send(link, ended(wire_reason(event.reason)))
            link.close(ENDED)

    def _dropped(self, event: Dropped) -> None:
        self._commands.pop((event.session_id, event.slot), None)
        link = self._controllers.get(event.session_id, {}).pop(event.slot, None)
        if link is None:
            return
        self._send(link, ended("dropped"))
        link.close(ENDED)
        self._left(link)

    def _cancelled(self, event: CodeCancelled) -> None:
        host = self._hosts.get(event.session_id)
        if host is not None:
            self._send(host, code_cancelled(event.reason))

    # -- connections ----------------------------------------------------------------------

    def attach_host(self, socket: Socket, session_id: UUID) -> Link:
        link = Link(socket, "host", session_id)
        old = self._hosts.get(session_id)
        self._hosts[session_id] = link
        if old is not None:
            old.close(REPLACED)
        self.service.registry.host_connected(session_id)
        self._send(link, welcome_host())
        for slot, phone in sorted(self._controllers.get(session_id, {}).items()):
            self._send(link, controller_joined(slot, phone.via or "code"))
        if old is None:
            for phone in self._phones(session_id):
                self._send(phone, host_status(True))
        return link

    def attach_controller(self, socket: Socket, seat: Seat) -> Link:
        link = Link(socket, "controller", seat.session_id, seat.slot, seat.via)
        phones = self._controllers.setdefault(seat.session_id, {})
        old = phones.get(seat.slot)
        phones[seat.slot] = link
        if old is not None:
            old.close(REPLACED)
        host = self._hosts.get(seat.session_id)
        self._send(link, welcome_controller(seat.slot, host is not None))
        if host is not None:
            self._send(host, controller_joined(seat.slot, seat.via))
        return link

    def detach(self, link: Link) -> None:
        """The connection is gone. Nothing changes if a newer one already took its place."""
        session_id = link.session_id
        if link.role == "host":
            if self._hosts.get(session_id) is not link:
                return
            del self._hosts[session_id]
            self.service.registry.host_lost(session_id, self.service.clock())
            for phone in self._phones(session_id):
                phone.outstanding = Outstanding()  # their commands will have no answer
                self._send(phone, host_status(False))
            return
        phones = self._controllers.get(session_id, {})
        if link.slot is None or phones.get(link.slot) is not link:
            return
        del phones[link.slot]
        if not phones:
            self._controllers.pop(session_id, None)
        self._left(link)

    def _left(self, link: Link) -> None:
        host = self._hosts.get(link.session_id)
        if host is not None and link.slot is not None:
            self._send(host, controller_left(link.slot, link.via or "code"))

    def _phones(self, session_id: UUID) -> list[Link]:
        return list(self._controllers.get(session_id, {}).values())

    # -- the router -----------------------------------------------------------------------

    def _drop(self, link: Link, reason: str) -> None:
        self.dropped[reason] += 1
        _logged("live.message_dropped", f"{link.role} {reason}", logging.DEBUG)

    def _send(self, link: Link, message: Message) -> None:
        """The one way the hub sends: only what the allowlist lets reach this role."""
        kind = message.get("type")
        route = outbound(routes(), kind, link.role) if isinstance(kind, str) else None
        if route is None or not valid(route.schema, message):
            label = kind if route is not None and isinstance(kind, str) else "unrouted"
            self.refused[label] += 1
            _logged("live.send_refused", f"{link.role} {label}", logging.ERROR)
            return
        link.put(encode(message))

    def handle(self, link: Link, text: str | None) -> None:
        """One frame from a connection after its `hello`, within its limits (None: binary)."""
        message = None if text is None else decode(text)
        if message is None:
            return self._drop(link, "not_a_message")
        route = inbound(routes(), link.role, message.get("type"))
        if isinstance(route, str):
            return self._drop(link, route)
        if not valid(route.schema, message):
            return self._drop(link, "invalid")
        if route.type == "companion_state":
            for phone in self._phones(link.session_id):
                self._send(phone, message)
        elif route.type == "command":
            self._command(link, message)
        elif route.type == "command_result":
            self._result(link, message)
        elif route.type == "end":
            self._spawn(asyncio.to_thread(self.service.end, link.session_id, "host_ended"))
        elif route.type == "make_code":
            self._make_code(link)
        else:
            # The host's `drop`, whose schema requires `slot` (1 or 2), or one of the host's
            # rider messages (ADR 0007: `rider_state`, `drop_rider`, `lock`, `new_join_code`),
            # whose closed schemas have no `slot`: routed by the contract, not built here yet,
            # so dropped and counted (tests/test_live_ws_router.py).
            slot = message.get("slot")
            if isinstance(slot, int):
                self.service.registry.host_drop(link.session_id, slot)
            else:
                self._drop(link, "not_built_yet")

    def _make_code(self, link: Link) -> None:
        made = self.service.registry.make_code(link.session_id, self.service.clock())
        if made is None:
            return self._drop(link, "code_limit")
        if made.earlier is not None:
            self._send(link, code_cancelled(made.earlier))
        self._send(link, control_code(made.code, made.expires_in_ms))

    def _command(self, link: Link, message: Message) -> None:
        if link.slot is None:  # not reached: only a controller's command has a route
            return self._drop(link, "not_from_role")
        window = self._commands.setdefault((link.session_id, link.slot), commands_window())
        host = self._hosts.get(link.session_id)
        outcome = on_command(
            message, link.slot, window.take(self.service.clock()), host is not None
        )
        if isinstance(outcome, Answer) or host is None:
            self._send(link, outcome.message)
            return
        link.outstanding.add(str(message["id"]))
        self._send(host, outcome.message)

    def _result(self, link: Link, message: Message) -> None:
        slot = message["slot"]  # 1 or 2: the schema holds it to those integers
        phone = (
            self._controllers.get(link.session_id, {}).get(slot) if isinstance(slot, int) else None
        )
        if phone is None or not phone.outstanding.answer(str(message["id"])):
            return self._drop(link, "unmatched_result")
        self._send(phone, ack_of(message))

    def _spawn(self, work: Coroutine[Any, Any, object]) -> None:
        task = asyncio.create_task(work)
        self._tasks.add(task)
        task.add_done_callback(self._done)

    def _done(self, task: asyncio.Task[object]) -> None:
        self._tasks.discard(task)
        error = None if task.cancelled() else task.exception()
        if error is not None:
            _logged("live.end_failed", type(error).__name__, logging.ERROR)

    def connected(self, session_id: UUID) -> tuple[bool, tuple[int, ...]]:
        """Whether the host is connected, and the slots of the connected phones (for tests)."""
        return session_id in self._hosts, tuple(sorted(self._controllers.get(session_id, {})))
