"""SQL of the live process (player_backend/db/live.py): ADR 0002, sections 8 and 9, and ADR 0005,
section 2. The re-check calls the two `auth_*_active` functions for many hashes at once; the
listening connection runs the one `LISTEN`. The hashes are always bound parameters."""

from typing import Final

from player_backend.db.executor import Query

# The live process's own connection listens on the channel of the revoking transactions
# (queries/revocation.py). A notice carries the account id and no authority.
LISTEN: Final[Query] = Query("LISTEN live_revocations")

# The re-check: for each hash, whether the device token still works. One row per hash given.
DEVICES_ACTIVE: Final[Query] = Query(
    "SELECT h, player.auth_device_active(h) FROM unnest(%s::bytea[]) AS t(h)"
)

# The re-check of controllers got by sign-in: whether each site session still works.
SESSIONS_ACTIVE: Final[Query] = Query(
    "SELECT h, player.auth_session_active(h) FROM unnest(%s::bytea[]) AS t(h)"
)
