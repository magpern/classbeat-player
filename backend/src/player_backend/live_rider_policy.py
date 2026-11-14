"""Pure rules for the riders of a live session (ADR 0007, sections 2 and 3; ADR 0002, sections
8 and 10).

- A nickname is 1 to 24 characters (code points) once control characters are removed: every
  character of the Unicode categories Cc (controls), Cf (format characters, the bidirectional
  overrides among them), Cs (lone surrogates), Zl and Zp (line and paragraph separators), Cn
  (unassigned code points and noncharacters, U+FFFE among them) and Co (private use), and the
  white space at either end. Nothing left, or more than 24, is no nickname.
- A rider's id is 8 random bytes, written as base64url without padding (11 characters). It is
  drawn at the join (live/riders.py), never derived from the token or the nickname.
- Places: at most 60 rider connections open in a session at a time. The cap counts tokens with
  a connection open, not tokens given out; a token's new connection replacing its old one takes
  no new place.
- A rider token with no connection for 5 minutes is dropped, and so is one that never
  connected (its 5 minutes run from the join).
- Joins: 120 a minute per session, every join that names the session counted. Joins with a code
  that names no session (an earlier code included) are counted per address, with the control
  exchanges' (live_code_policy.py, `UnknownSessions`).
- New join codes: 10 a session an hour; one more is ignored and counted.

Times are seconds of one monotonic clock, passed in. No I/O here.
"""

from __future__ import annotations

import base64
import unicodedata
from typing import Final

RIDERS_CONNECTED_MAX: Final = 60
RIDER_AWAY_LIMIT: Final = 5 * 60.0
JOINS_PER_MINUTE: Final = 120
JOIN_CODES_PER_HOUR: Final = 10
RIDER_ID_BYTES: Final = 8
NICKNAME_MAX: Final = 24

# The categories a nickname loses (see above).
_REMOVED: Final = frozenset({"Cc", "Cf", "Cs", "Zl", "Zp", "Cn", "Co"})


def clean_nickname(raw: object) -> str | None:
    """The nickname with its control characters removed, or None when it is not 1 to 24."""
    if not isinstance(raw, str):
        return None
    kept = "".join(c for c in raw if unicodedata.category(c) not in _REMOVED).strip()
    if not 1 <= len(kept) <= NICKNAME_MAX:
        return None
    return kept


def rider_id(raw: bytes) -> str:
    """A rider's id from its 8 random bytes: base64url without padding."""
    if len(raw) != RIDER_ID_BYTES:
        raise ValueError("a rider id is 8 bytes")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def has_place(connected: int, already_connected: bool) -> bool:
    """Whether a rider token's connection may open, with `connected` tokens connected now."""
    return already_connected or connected < RIDERS_CONNECTED_MAX


def gone(connections: int, away_since: float, now: float) -> bool:
    """Whether a rider token is dropped by `now`: no connection for its 5 minutes."""
    return connections == 0 and now - away_since >= RIDER_AWAY_LIMIT
