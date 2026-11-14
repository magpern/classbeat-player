"""The live connections of every session, and the router between them (ADR 0002, section 8;
ADR 0005, sections 1 and 3 to 6; ADR 0007, sections 2 and 3).

- One connection per token: a new host connection, or a controller's with the same token,
  replaces the old one, which is closed with 4409.
- The host is told `welcome`, then `controller_joined` for each phone connected; a controller
  is told `welcome` with its slot and whether the host is in. Controllers get `host_status`
  when the host comes and goes, and nothing else while it is away; the host gets
  `controller_joined` and `controller_left` as phones come and go.
- Every message after `hello` is routed by the allowlist (live_route_policy.py), checked with
  its schema for its sender's role; anything else is dropped and counted in `dropped`. The
  handlers are keyed by the routed type (`acted_on`), one `_on_<type>` each. Every message the
  hub sends goes through live/sender.py's allowlist; one that fails is not sent (`refused`).
- Riders (ADR 0007) are live/rider_role.py's: a rider sends nothing after `hello` (no route
  names it a sender); the host's rider operations, comings and goings and the end go there.
- Commands and their answers are live/command_relay.py's (live_relay_policy.py). A host that
  leaves takes its unanswered commands with it: their answers from a returning host reach no one.
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
from collections.abc import Callable, Coroutine
from typing import Any, cast
from uuid import UUID

from player_backend.live.command_relay import CommandRelay
from player_backend.live.events import CodeCancelled, Dropped, Ended, RiderSeat, Seat
from player_backend.live.link import Link, Socket
from player_backend.live.rider_role import RiderRole
from player_backend.live.schemas import routes, valid
from player_backend.live.sender import Sender
from player_backend.live.sender import logged as _logged
from player_backend.live.service import LiveService
from player_backend.live.watchers import Event
from player_backend.live_limit_policy import HELLO_WITHIN, AddressGate
from player_backend.live_relay_policy import Outstanding
from player_backend.live_route_policy import acted_on, inbound
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
    ended,
    host_status,
    welcome_controller,
    welcome_host,
)

type Handler = Callable[[Link, Message], None]


def _by_type(*handlers: Handler) -> dict[str, Handler]:
    """The handlers keyed by the routed type each is named for (`_on_<type>`). They must be the
    types the table lets a connection send after `hello` (`acted_on`), exactly, or there is no
    hub: a routed type with no handler, or a handler for no routed type, fails at start."""
    table = {h.__name__.removeprefix("_on_"): h for h in handlers}
    if len(table) != len(handlers) or set(table) != set(acted_on(routes())):
        raise RuntimeError("the live hub's handlers are not the routing table's types")
    return table


class Hub:
    def __init__(self, service: LiveService, hello_within: float = HELLO_WITHIN) -> None:
        self.service = service
        self.hello_within = hello_within  # how long a connection has for its `hello`
        self.gate = AddressGate()  # the per-address connection limits
        self.sender = Sender()
        self.dropped = self.sender.dropped  # messages dropped, by reason
        self.refused = self.sender.refused  # messages the hub would not send, by type
        self._send, self._drop = self.sender.send_one, self.sender.drop
        self.riders = RiderRole(service.registry, self.sender, service.clock)
        self.commands = CommandRelay(self.sender, service.clock)
        self._on = _by_type(
            self._on_make_code,
            self._on_drop,
            self._on_companion_state,
            self._on_command,
            self._on_command_result,
            self._on_end,
            self._on_rider_state,
            self._on_drop_rider,
            self._on_lock,
            self._on_new_join_code,
        )
        self._loop: asyncio.AbstractEventLoop | None = None
        self._hosts: dict[UUID, Link] = {}
        self._controllers: dict[UUID, dict[int, Link]] = {}
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
        self.commands.forget(event.session_id, (1, 2))
        message = ended(wire_reason(event.reason))
        for link in links:
            self._send(link, message)
            link.close(ENDED)
        self.riders.end(event.session_id, message)

    def _dropped(self, event: Dropped) -> None:
        self.commands.forget(event.session_id, (event.slot,))
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
        self.riders.host_in(link)
        if old is None:
            self.sender.send_all(self._phones(session_id), host_status(True))
            self.riders.host_status(session_id, True)
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

    def attach_rider(self, socket: Socket, seat: RiderSeat) -> Link:
        return self.riders.attach(socket, seat, self._hosts.get(seat.session_id))

    def detach(self, link: Link) -> None:
        """The connection is gone. Nothing changes if a newer one already took its place."""
        session_id = link.session_id
        if link.role == "rider":
            return self.riders.detach(link, self._hosts.get(session_id))
        if link.role == "host":
            if self._hosts.get(session_id) is not link:
                return
            del self._hosts[session_id]
            self.service.registry.host_lost(session_id, self.service.clock())
            for phone in self._phones(session_id):
                phone.outstanding = Outstanding()  # their commands will have no answer
                self._send(phone, host_status(False))
            return self.riders.host_status(session_id, False)
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
        self._on[route.type](link, message)

    # Each handler gets a message its route took from the sender's role, valid by its schema.

    def _on_companion_state(self, link: Link, message: Message) -> None:
        self.sender.send_all(self._phones(link.session_id), message)

    def _on_rider_state(self, link: Link, message: Message) -> None:
        self.riders.relay(link.session_id, message)

    def _on_end(self, link: Link, _message: Message) -> None:
        self._spawn(asyncio.to_thread(self.service.end, link.session_id, "host_ended"))

    def _on_drop(self, link: Link, message: Message) -> None:
        self.service.registry.host_drop(link.session_id, cast(int, message["slot"]))

    def _on_drop_rider(self, link: Link, message: Message) -> None:
        self.riders.drop(link, str(message["rider"]))

    def _on_lock(self, link: Link, message: Message) -> None:
        self.riders.lock(link, message["locked"] is True)

    def _on_new_join_code(self, link: Link, _message: Message) -> None:
        self.riders.new_join_code(link)

    def _on_make_code(self, link: Link, _message: Message) -> None:
        made = self.service.registry.make_code(link.session_id, self.service.clock())
        if made is None:
            return self._drop(link, "code_limit")
        if made.earlier is not None:
            self._send(link, code_cancelled(made.earlier))
        self._send(link, control_code(made.code, made.expires_in_ms))

    def _on_command(self, link: Link, message: Message) -> None:
        self.commands.command(link, self._hosts.get(link.session_id), message)

    def _on_command_result(self, link: Link, message: Message) -> None:
        slot = message["slot"]  # 1 or 2: the schema holds it to those integers
        phones = self._controllers.get(link.session_id, {})
        self.commands.result(link, phones.get(slot) if isinstance(slot, int) else None, message)

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
