"""SQL of the operator's commands (player_backend/db/operator.py), run as player_owner."""

from typing import Final

from player_backend.db.executor import Query

# The role the handle acts as: the commands refuse to run as anything but player_owner.
CURRENT_ROLE: Final[Query] = Query("SELECT current_user::text")

# ADR 0002, section 9: the allowlist's one policy is for player_owner, allowing everything.
ALLOWLIST_ADD: Final[Query] = Query(
    "INSERT INTO player.signup_allowlist (email) VALUES (%s) "
    "ON CONFLICT (email) DO NOTHING RETURNING email"
)
ALLOWLIST_REMOVE: Final[Query] = Query(
    "DELETE FROM player.signup_allowlist WHERE email = %s RETURNING email"
)
ALLOWLIST_LIST: Final[Query] = Query(
    "SELECT email, added_at FROM player.signup_allowlist ORDER BY email"
)

PURGE_EXPIRED: Final[Query] = Query("SELECT player.auth_purge_expired()")
