"""SQL of the events classbeat sends (player_backend/db/classbeat_events.py; ADR 0010, section
8): the address's count, and the call of `auth_classbeat_event`."""

from typing import Final

from player_backend.db.executor import Query

# Section 9, the limits: events per address, counted before the token is checked. True when
# over the limit.
LIMIT_HIT: Final[Query] = Query("SELECT player.rate_limit_hit(%s, %s, %s)")

CLASSBEAT_EVENT: Final[Query] = Query("SELECT player.auth_classbeat_event(%s, %s, %s, %s)")
