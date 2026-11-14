"""The riders' connections on the live WebSocket, and the host's operations on them (ADR 0007,
sections 2 and 3; ADR 0002, section 8). The tokens, places, lock and join codes are the
registry's (live/riders.py); this module holds the connections and tells who needs to know.

- A rider token's `hello` gets the rider `welcome` and the current `host_status`. One connection
  per token: a newer one replaces the older (4409) and tells the host nothing.
- The host hears of connections, not tokens: `rider_joined` when a token's connection completes
  `hello` and it had none open (the first time, or again after a `left`); `rider_left` `left`
  when its last connection closes; `rider_left` `dropped` when the host removed it. A token that
  never connects, and the 5-minute drop of one that has left, tell no one.
- A host that connects is told `rider_joined` for every rider connected now; one that connects
  again (any connection after the session's first) is told the `lock_state` after them.
- A rider is sent only `welcome`, `host_status`, `rider_state` and `ended` (the sender's
  allowlist). The host's `rider_state` is checked by its schema once and the same bytes go to
  every rider of the session; nothing about one rider reaches another.
- `drop_rider`: the token is dropped; its connection gets `ended` `dropped` and is closed with
  4403; the host gets `rider_left` `dropped`. A rider id the session does not hold is dropped
  and counted. `lock` is answered `lock_state`; `new_join_code` is answered `join_code`, or,
  past its 10 an hour, dropped and counted with nothing changed.
- The session's end: every rider gets `ended` and is closed with 4403.

Nothing here is logged: a nickname is only ever in `rider_joined`, to the host's connection.
Runs on the event loop only.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from player_backend.live.events import RiderSeat
from player_backend.live.link import Link, Socket
from player_backend.live.registry import Registry
from player_backend.live.sender import Sender
from player_backend.live_wire_policy import (
    ENDED,
    REPLACED,
    Message,
    ended,
    host_status,
    join_code,
    lock_state,
    rider_joined,
    rider_left,
    welcome_rider,
)


class RiderRole:
    def __init__(self, registry: Registry, sender: Sender, clock: Callable[[], float]) -> None:
        self._registry = registry
        self._sender = sender
        self._clock = clock
        self._links: dict[UUID, dict[str, Link]] = {}
        self._hosted: set[UUID] = set()  # sessions whose host has connected before

    def links(self, session_id: UUID) -> list[Link]:
        return list(self._links.get(session_id, {}).values())

    def attach(self, socket: Socket, seat: RiderSeat, host: Link | None) -> Link:
        link = Link(socket, "rider", seat.session_id, rider=seat.rider)
        riders = self._links.setdefault(seat.session_id, {})
        old = riders.get(seat.rider)
        riders[seat.rider] = link
        if old is not None:
            old.close(REPLACED)
        self._sender.send_one(link, welcome_rider(host is not None))
        self._sender.send_one(link, host_status(host is not None))
        if host is not None and seat.announced:
            self._sender.send_one(host, rider_joined(seat.rider, seat.nickname))
        return link

    def detach(self, link: Link, host: Link | None) -> None:
        """A rider's connection is gone. Each counted connection is uncounted once."""
        rider = link.rider
        if rider is None:  # not reached: every rider link has its id
            return
        last = self._registry.rider_disconnected(link.session_id, rider, self._clock())
        riders = self._links.get(link.session_id, {})
        if riders.get(rider) is link:
            del riders[rider]
            if not riders:
                self._links.pop(link.session_id, None)
        if last and host is not None:
            self._sender.send_one(host, rider_left(rider, "left"))

    def host_in(self, host: Link) -> None:
        """A host connection was attached: the riders in now, then (on a return) the lock."""
        session_id = host.session_id
        for rider in self._registry.riders_in(session_id):
            self._sender.send_one(host, rider_joined(rider.rider, rider.nickname))
        locked = self._registry.locked(session_id)
        if session_id in self._hosted and locked is not None:
            self._sender.send_one(host, lock_state(locked))
        self._hosted.add(session_id)

    def host_status(self, session_id: UUID, connected: bool) -> None:
        self._sender.send_all(self.links(session_id), host_status(connected))

    def relay(self, session_id: UUID, message: Message) -> None:
        """The host's `rider_state`, already checked by its schema, to every rider as it is."""
        self._sender.send_all(self.links(session_id), message)

    def drop(self, host: Link, rider: str) -> None:
        if not self._registry.drop_rider(host.session_id, rider):
            return self._sender.drop(host, "unknown_rider")
        riders = self._links.get(host.session_id, {})
        link = riders.pop(rider, None)
        if link is None:  # it had left: the host was told then, and its token is gone now
            return
        if not riders:
            self._links.pop(host.session_id, None)
        self._sender.send_one(link, ended("dropped"))
        link.close(ENDED)
        self._sender.send_one(host, rider_left(rider, "dropped"))

    def lock(self, host: Link, locked: bool) -> None:
        state = self._registry.lock(host.session_id, locked)
        if state is not None:
            self._sender.send_one(host, lock_state(state))

    def new_join_code(self, host: Link) -> None:
        code = self._registry.new_join_code(host.session_id, self._clock())
        if code is None:
            return self._sender.drop(host, "join_code_limit")
        self._sender.send_one(host, join_code(code))

    def end(self, session_id: UUID, message: Message) -> None:
        """The session ended: `message` (its `ended`) to every rider, then 4403."""
        self._hosted.discard(session_id)
        for link in list(self._links.pop(session_id, {}).values()):
            self._sender.send_one(link, message)
            link.close(ENDED)
