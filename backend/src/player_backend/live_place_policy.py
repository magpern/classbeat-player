"""Pure rules for the two controller places of a live session and their replay after every host
`welcome` (ADR 0002, section 8; ADR 0005, section 3 and section 10, amended 2026-11-14).

- A session has at most 2 controllers, in slots 1 and 2.
- The server never buffers for a host that is away, so right after each host `welcome` it names
  both places once, in slot order: `controller_joined` for a place whose token is connected,
  `controller_left` `disconnected` for one whose token is held but not connected, and
  `controller_left` `free` (no `via`) for a place that holds no token. The app sets both places
  from the replay alone.
- What the registry holds decides: a connection whose token no longer holds its place (its drop
  is on its way to the hub) is not named as connected; the drop's own `controller_left` follows.

No I/O here.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from typing import Final

from player_backend.live_token_policy import Via
from player_backend.live_wire_policy import (
    Message,
    controller_free,
    controller_joined,
    controller_left,
)

SLOTS: Final = (1, 2)


def replay(held: Mapping[int, Via], connected: Collection[int]) -> list[Message]:
    """One message per place, slots 1 and 2 in order. `held`: the places with a token, by slot,
    with how it was got; `connected`: the slots with an open controller connection."""
    out: list[Message] = []
    for slot in SLOTS:
        via = held.get(slot)
        if via is None:
            out.append(controller_free(slot))
        elif slot in connected:
            out.append(controller_joined(slot, via))
        else:
            out.append(controller_left(slot, via, "disconnected"))
    return out
