"""Whether an account may add a passkey, and how many the list may hold (ADR 0002, sections 4
and 11; ADR 0010, section 7). Pure: no I/O.

`passkeys_open` is the one rule: both steps of a registration refuse with it
(`db.passkeys.registration_open`), and `GET /api/site/passkeys` answers it as `can_add`, so the
two can never disagree.

The cap of 10 passkeys is held when one is added, under the account's additions lock. More than
10 rows is a data fault, never a state the site is shown: the list reads at most
`LIST_READ_MAX` rows, one over the cap so the fault is seen, and refuses to answer
(`PasskeysOverCap`, a 500 `internal_error`). It never shows the first 10 alone, which would hide
a passkey that can still sign in.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from player_backend.own_sign_in_policy import own_sign_in_open
from player_backend.passkey_policy import PASSKEYS_MAX

# One over the cap: the read is bounded, and a broken cap is still seen.
LIST_READ_MAX: Final = PASSKEYS_MAX + 1


class PasskeysOverCap(RuntimeError):
    """The account holds more passkeys than the cap allows: a data fault. Its message holds no
    data of the account."""

    def __init__(self) -> None:
        super().__init__("more passkeys than the cap")


def passkeys_open(found: Sequence[Sequence[object]]) -> bool:
    """Whether the account may register a passkey, from the rows its kind's query found: exactly
    one, of a kind open to the own sign-in. Anything else is refused (fail closed)."""
    return len(found) == 1 and len(found[0]) == 1 and own_sign_in_open(found[0][0])


def within_cap(count: int) -> bool:
    """Whether a list of `count` passkeys is one the site may be shown."""
    return 0 <= count <= PASSKEYS_MAX
