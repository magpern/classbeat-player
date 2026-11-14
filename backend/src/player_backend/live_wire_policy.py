"""Pure rules for what crosses the live WebSocket (ADR 0002, section 8; ADR 0005, s. 4 and 6).

- A message is one JSON object in a text frame. Anything else (a binary frame, a JSON value
  that is not an object, `NaN` or `Infinity`, a key given twice, a number written with a
  fraction or an exponent: every number in the contract is an integer) is not a message.
- The server never passes a frame on as it came: what it sends is built here, or is the value
  that passed its schema, encoded again. So what reaches a connection is exactly what was
  checked.
- Close codes: 4401 no good `hello` in time (a missing, late, malformed or refused one, a
  controller or rider from another origin); 4403 the session ended or the token was dropped (a
  controller's, or a rider's the host removed), after an `ended`; 4409 a newer connection with
  the same token took its place; 1009 a message over its size; 1008 more messages than the
  limit, or a connection that does not read what it is sent.

No I/O here.
"""

from __future__ import annotations

import json
from typing import Final, Literal, cast

from player_backend.live_code_policy import CancelReason
from player_backend.live_session_policy import WireReason
from player_backend.live_token_policy import Via

HELLO_REFUSED: Final = 4401
ENDED: Final = 4403
REPLACED: Final = 4409
TOO_BIG: Final = 1009
TOO_MANY: Final = 1008

type Message = dict[str, object]
type Result = Literal["applied", "duplicate", "refused"]
# Why a place holds no connected controller, as this process tells it today (ADR 0005 section 10,
# amended 2026-11-14). The contract's fourth reason, `free` (without `via`, in the replay after a
# host `welcome`), is not sent yet.
type LeftReason = Literal["disconnected", "session_ended", "dropped"]


class _NotJson(ValueError):
    pass


def _no_constant(_name: str) -> object:
    raise _NotJson


def _no_twice(pairs: list[tuple[str, object]]) -> Message:
    out: Message = {}
    for key, value in pairs:
        if key in out:
            raise _NotJson
        out[key] = value
    return out


def decode(text: str) -> Message | None:
    """The message a text frame holds, or None when it holds none."""
    try:
        value: object = json.loads(
            text,
            parse_constant=_no_constant,
            parse_float=_no_constant,
            object_pairs_hook=_no_twice,
        )
    except (ValueError, RecursionError):
        return None
    return cast(Message, value) if isinstance(value, dict) else None


def encode(message: Message) -> str:
    return json.dumps(message, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def size(text: str) -> int:
    """A text frame's size in UTF-8 bytes, as the limits count it."""
    return len(text.encode("utf-8", "surrogatepass"))


def welcome_host() -> Message:
    return {"v": 1, "type": "welcome", "role": "host"}


def welcome_controller(slot: int, host_connected: bool) -> Message:
    return {
        "v": 1,
        "type": "welcome",
        "role": "controller",
        "slot": slot,
        "hostConnected": host_connected,
    }


def welcome_rider(host_connected: bool) -> Message:
    """A rider's welcome (welcome-rider.schema.json): its role and whether the host is in."""
    return {"v": 1, "type": "welcome", "role": "rider", "hostConnected": host_connected}


def host_status(connected: bool) -> Message:
    return {"v": 1, "type": "host_status", "connected": connected}


def controller_joined(slot: int, via: Via) -> Message:
    return {"v": 1, "type": "controller_joined", "slot": slot, "via": via}


def controller_left(slot: int, via: Via, reason: LeftReason) -> Message:
    return {"v": 1, "type": "controller_left", "slot": slot, "via": via, "reason": reason}


def ended(reason: WireReason) -> Message:
    return {"v": 1, "type": "ended", "reason": reason}


def control_code(code: str, expires_in_ms: int) -> Message:
    """The new control code, for the host only (the routing allowlist holds it to the host)."""
    return {"v": 1, "type": "control_code", "code": code, "expiresInMs": expires_in_ms}


def code_cancelled(reason: CancelReason) -> Message:
    return {"v": 1, "type": "code_cancelled", "reason": reason}


def rider_joined(rider: str, nickname: str) -> Message:
    """To the host only: the one message that holds a nickname (ADR 0007, section 2)."""
    return {"v": 1, "type": "rider_joined", "rider": rider, "nickname": nickname}


def rider_left(rider: str, reason: Literal["left", "dropped"]) -> Message:
    return {"v": 1, "type": "rider_left", "rider": rider, "reason": reason}


def lock_state(locked: bool) -> Message:
    return {"v": 1, "type": "lock_state", "locked": locked}


def join_code(code: str) -> Message:
    """The new join code, for the host only (the routing allowlist holds it to the host)."""
    return {"v": 1, "type": "join_code", "code": code}
