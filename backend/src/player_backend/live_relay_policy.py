"""Pure rules for the commands the live process relays (ADR 0005, sections 1, 3, 4 and 5).

- A controller's `command` (its schema has no `slot`) is answered by the server itself with
  `ack` `rate` beyond 2 a second, and with `ack` `host_away` while the host is not connected:
  nothing is forwarded, and nothing is kept to be forwarded later. Otherwise it goes to the host
  with the `slot` the server gave that controller.
- `ack` has one sender, the server, and one receiver, the controller in the `slot` the host's
  `command_result` names, and only for a command the server forwarded from that controller's
  connection and that has no answer yet. A result for anything else reaches no one.
- The server makes no command and changes none: the forwarded command is the phone's fields,
  as they passed the schema, with `slot` added.

No I/O here.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import Final, Literal

from player_backend.live_wire_policy import Message

# Commands forwarded and not yet answered, per controller connection. At 2 a second the host
# answers long before this fills; the oldest is forgotten first.
OUTSTANDING_MAX: Final = 64
_COMMAND_FIELDS: Final = ("id", "run", "basis", "action", "deltaMs")

type ServerReason = Literal["rate", "host_away"]


@dataclass(frozen=True)
class Forward:
    message: Message  # to the host


@dataclass(frozen=True)
class Answer:
    message: Message  # the `ack`, to the controller that sent the command


def ack(command_id: object, result: str, reason: str | None) -> Message:
    return {"v": 1, "type": "ack", "id": command_id, "result": result, "reason": reason}


def forwarded(command: Message, slot: int) -> Message:
    """The phone's command as the host gets it: its own fields and the server's `slot`."""
    out: Message = {"v": 1, "type": "command", "slot": slot}
    for name in _COMMAND_FIELDS:
        if name in command:
            out[name] = command[name]
    return out


def on_command(command: Message, slot: int, within_rate: bool, host_in: bool) -> Forward | Answer:
    """What the server does with a controller's valid `command`."""
    if not within_rate:
        return Answer(ack(command["id"], "refused", "rate"))
    if not host_in:
        return Answer(ack(command["id"], "refused", "host_away"))
    return Forward(forwarded(command, slot))


def ack_of(result: Message) -> Message:
    """The host's valid `command_result` passed on as `ack` (its `slot` is not passed on)."""
    return ack(result["id"], str(result["result"]), _reason(result["reason"]))


def _reason(value: object) -> str | None:
    return None if value is None else str(value)


class Outstanding:
    """The ids forwarded from one controller connection that have no answer yet."""

    def __init__(self) -> None:
        self._ids: OrderedDict[str, None] = OrderedDict()

    def add(self, command_id: str) -> None:
        self._ids[command_id] = None
        self._ids.move_to_end(command_id)
        while len(self._ids) > OUTSTANDING_MAX:
            self._ids.popitem(last=False)

    def answer(self, command_id: str) -> bool:
        """True once for a forwarded id: the result may go on as its `ack`."""
        return self._ids.pop(command_id, False) is None

    def __len__(self) -> int:
        return len(self._ids)
