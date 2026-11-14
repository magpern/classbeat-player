"""The hub's one way of sending, and its count of what it drops (ADR 0002, section 8; ADR 0005,
section 7; ADR 0007, sections 2 and 6).

- Every message the hub sends is checked against the allowlist and its schema for the
  receiver's role first; one that fails is not sent (counted in `refused`). So the function that
  sends to riders accepts only the four types the table routes to a rider.
- `send_all` checks a message once per role and encodes it once: every connection of a role
  gets the same bytes (one host `rider_state`, unchanged, to every rider of the session).
- A message the router does not take is dropped and counted in `dropped`, by reason.

Logs hold fixed words only: a role, a message type, a drop reason. Never a message, a token, a
code, a rider id or a nickname. Runs on the event loop only.
"""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Iterable

from player_backend.live.link import Link
from player_backend.live.schemas import routes, valid
from player_backend.live_route_policy import Role, outbound
from player_backend.live_wire_policy import ENDED, Message, encode

_log = logging.getLogger("player_backend.live")


def logged(event: str, detail: str, level: int = logging.INFO) -> None:
    """`detail` is a fixed word: a role, a drop reason, a message type or an error's type."""
    _log.log(level, "live: %s", detail, extra={"fields": {"event": event}})


class Sender:
    def __init__(self) -> None:
        self.dropped: Counter[str] = Counter()  # messages dropped, by reason
        self.refused: Counter[str] = Counter()  # messages the hub would not send, by type

    def _checked(self, role: Role, message: Message) -> str | None:
        """The message encoded, if the allowlist lets it reach `role`; else counted."""
        kind = message.get("type")
        route = outbound(routes(), kind, role) if isinstance(kind, str) else None
        if route is None or not valid(route.schema, message):
            label = kind if route is not None and isinstance(kind, str) else "unrouted"
            self.refused[label] += 1
            logged("live.send_refused", f"{role} {label}", logging.ERROR)
            return None
        return encode(message)

    def send_one(self, link: Link, message: Message) -> None:
        """Only what the allowlist lets reach this connection's role."""
        text = self._checked(link.role, message)
        if text is not None:
            link.put(text)

    def send_all(self, links: Iterable[Link], message: Message) -> None:
        """One message to many connections: checked once per role, the same bytes to each."""
        texts: dict[Role, str | None] = {}
        for link in links:
            if link.role not in texts:
                texts[link.role] = self._checked(link.role, message)
            text = texts[link.role]
            if text is not None:
                link.put(text)

    def end(self, link: Link, message: Message) -> None:
        """`message` (an `ended`) to the connection, then its close with 4403."""
        self.send_one(link, message)
        link.close(ENDED)

    def drop(self, link: Link, reason: str) -> None:
        self.dropped[reason] += 1
        logged("live.message_dropped", f"{link.role} {reason}", logging.DEBUG)
