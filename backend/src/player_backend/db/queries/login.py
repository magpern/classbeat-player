"""SQL of email link sign-in (player_backend/db/login.py): calls of the `auth_*` functions."""

from typing import Final

from player_backend.db.executor import Query

# Section 10: the requester's own limit, counted before the sign-in call. True when over it.
ADDRESS_LIMIT_HIT: Final[Query] = Query("SELECT player.rate_limit_hit(%s, %s, %s)")

REQUEST_LOGIN: Final[Query] = Query(
    "SELECT player.auth_request_login(%s, %s, %s, %s, ROW(%s::cidr, %s)::player.client_info)"
)

COMPLETE_LOGIN: Final[Query] = Query(
    "SELECT player.auth_complete_login(%s, %s, %s, ROW(%s::cidr, %s)::player.client_info)"
)
