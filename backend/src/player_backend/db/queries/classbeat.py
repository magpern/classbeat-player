"""SQL of sign-in with classbeat (player_backend/db/classbeat.py): calls of the `auth_*`
functions of ADR 0010, sections 2, 4 and 5."""

from typing import Final

from player_backend.db.executor import Query

START_CLASSBEAT: Final[Query] = Query(
    "SELECT player.auth_start_classbeat(%s, %s, %s, %s, %s, %s, %s, %s)"
)

TAKE_CLASSBEAT: Final[Query] = Query(
    "SELECT purpose, nonce_hash, asking_session_hash, started_at"
    " FROM player.auth_take_classbeat(%s, %s, %s)"
)

COMPLETE_CLASSBEAT: Final[Query] = Query(
    "SELECT player.auth_complete_classbeat("
    "%s, %s, %s, %s, %s, %s, %s, ROW(%s::cidr, %s)::player.client_info)"
)

REAUTH_CLASSBEAT: Final[Query] = Query(
    "SELECT player.auth_reauth_classbeat("
    "%s, %s, %s, %s, %s, %s, ROW(%s::cidr, %s)::player.client_info)"
)
