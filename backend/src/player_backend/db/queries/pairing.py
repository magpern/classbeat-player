"""SQL of pairing a device (player_backend/db/pairing.py): calls of the `auth_*` functions."""

from typing import Final

from player_backend.db.executor import Query

# Section 10: pairing starts per address, counted before the start. True when over the limit.
START_LIMIT_HIT: Final[Query] = Query("SELECT player.rate_limit_hit(%s, %s, %s)")

START_PAIRING: Final[Query] = Query("SELECT player.auth_start_pairing(%s, %s, %s, %s)")

COLLECT_PAIRING: Final[Query] = Query(
    "SELECT state, email "
    "FROM player.auth_collect_pairing(%s, %s, ROW(%s::cidr, %s)::player.client_info)"
)

# Both for the account already set: they run inside a signed-in request's transaction.
FIND_PAIRING: Final[Query] = Query("SELECT platform, version FROM player.auth_find_pairing(%s)")

DECIDE_PAIRING: Final[Query] = Query(
    "SELECT player.auth_decide_pairing(%s, %s, %s, ROW(%s::cidr, %s)::player.client_info)"
)
