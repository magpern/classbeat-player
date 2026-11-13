"""SQL of passkey sign-in (player_backend/db/passkey_login.py): calls of the `auth_*` functions."""

from typing import Final

from player_backend.db.executor import Query

# Section 10: failed passkey sign-ins, and sign-in challenge starts, per address. True when
# over the limit.
LIMIT_HIT: Final[Query] = Query("SELECT player.rate_limit_hit(%s, %s, %s)")

# One attempt at a time per address, from its check of the failures to its commit, so parallel
# attempts cannot all pass the check before any has counted its failure.
LOCK_FAILED: Final[Query] = Query("SELECT pg_advisory_xact_lock(%s, %s)")

NEW_CHALLENGE: Final[Query] = Query("SELECT player.auth_new_login_challenge(%s, %s)")

PASSKEY_FOR_LOGIN: Final[Query] = Query(
    "SELECT public_key, sign_count FROM player.auth_passkey_for_login(%s)"
)

COMPLETE_PASSKEY: Final[Query] = Query(
    "SELECT player.auth_complete_passkey(%s, %s, %s, %s, %s, ROW(%s::cidr, %s)::player.client_info)"
)
