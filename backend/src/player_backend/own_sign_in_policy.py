"""Which account kinds may use the player's own sign-in: the email link and passkeys (ADR 0010,
section 7). Pure: no I/O.

Both stay built and tested, and are closed for every kind there is today. They are open only
for `follower`, a kind that no function makes yet, so in practice they refuse every account.
Re-opening them for a kind is the follower ADR's decision. The database applies the same rule
inside `auth_request_login`, `auth_complete_login` and `auth_complete_passkey` (migration 0015);
the backend applies it to passkey registration, which runs as `player_app`.
"""

from __future__ import annotations

from typing import Final

# Every kind of `accounts.kind` (migration 0014), and those the own sign-in is open for.
ACCOUNT_KINDS: Final = frozenset({"instructor", "unlinked", "follower"})
OWN_SIGN_IN_KINDS: Final = frozenset({"follower"})


def own_sign_in_open(kind: object) -> bool:
    """Whether an account of `kind` may register a passkey. Anything that is not a known kind
    open to the own sign-in is refused (fail closed)."""
    return isinstance(kind, str) and kind in OWN_SIGN_IN_KINDS
