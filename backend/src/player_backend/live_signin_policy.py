"""Pure rules for the limits of `POST /api/live/controller`, a controller by sign-in (ADR 0005,
section 10, amended 2026-11-13; ADR 0002, section 10).

- A call without a valid site session is refused before any join code is looked up. Such calls
  are counted per address: 60 a minute. Past that, further calls without a session from that
  address are refused until the minute ends. A call with a valid session is never refused by
  this count and adds nothing to it.
- A signed-in call whose join code names no session of the account is counted per account: 60 a
  minute. Past that, every call of that account is refused until the minute ends, whatever its
  code. A code that names another account's session counts the same as one that names none, so
  the count tells nothing about which codes exist.
- Both places held is not a wrong try and counts against neither limit.
- Neither limit is the per-address limit of joins and control exchanges
  (live_code_policy.py, `UnknownSessions`): the sign-in route neither counts against it nor is
  refused by it.

Every refusal is the route's one answer, 403 `cannot_control`. Keys are hashes or account ids,
never addresses. Fixed windows: a minute from a key's first count. Times are seconds of one
monotonic clock, passed in. No I/O here.
"""

from __future__ import annotations

from typing import Final

SIGNED_OUT_PER_MINUTE: Final = 60  # per address
UNKNOWN_PER_MINUTE: Final = 60  # per account
WINDOW: Final = 60.0
# Above this many keys held, a count forgets the ones whose minute is over.
_PRUNE_ABOVE: Final = 4096


class MinuteCount:
    """At most `limit` counts per key in a fixed minute from the key's first count."""

    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._held: dict[bytes, tuple[float, int]] = {}

    def refused(self, key: bytes, now: float) -> bool:
        """Whether `key` has used up its minute."""
        held = self._held.get(key)
        return held is not None and held[1] >= self._limit and now - held[0] < WINDOW

    def count(self, key: bytes, now: float) -> None:
        if len(self._held) > _PRUNE_ABOVE:
            self._held = {k: h for k, h in self._held.items() if now - h[0] < WINDOW}
        held = self._held.get(key)
        if held is None or now - held[0] >= WINDOW:
            self._held[key] = (now, 1)
        else:
            self._held[key] = (held[0], held[1] + 1)

    def held(self) -> int:
        return len(self._held)


class SignInLimits:
    """The two counts of the sign-in route: calls without a session per address, and unknown
    join codes per account."""

    def __init__(self) -> None:
        self._signed_out = MinuteCount(SIGNED_OUT_PER_MINUTE)
        self._unknown = MinuteCount(UNKNOWN_PER_MINUTE)

    def signed_out_refused(self, address_key: bytes, now: float) -> bool:
        """Whether a call without a session from this address is refused unseen."""
        return self._signed_out.refused(address_key, now)

    def signed_out(self, address_key: bytes, now: float) -> None:
        """A call from this address had no valid site session."""
        self._signed_out.count(address_key, now)

    def account_refused(self, account_key: bytes, now: float) -> bool:
        """Whether every call of this account is refused before its code is looked up."""
        return self._unknown.refused(account_key, now)

    def unknown_code(self, account_key: bytes, now: float) -> None:
        """A call of this account named no session of the account."""
        self._unknown.count(account_key, now)
