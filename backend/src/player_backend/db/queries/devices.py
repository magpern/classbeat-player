"""SQL of devices and the device token (player_backend/db/devices.py). Every statement on a
tenant table filters by the account in the code; the policy is the backstop (ADR 0002, s. 9)."""

from typing import Final

from player_backend.db.executor import Query

# The first statement of a device-token request's transaction. Always one row.
ENTER_DEVICE: Final[Query] = Query("SELECT device_id, state FROM player.auth_enter_device(%s)")

# The account the function set for this transaction, and the transaction's time.
CURRENT_ACCOUNT: Final[Query] = Query(
    "SELECT nullif(current_setting('app.account_id', true), '')::uuid, now()"
)

# Section 10: the counters of bearer tokens. True when over the limit.
LIMIT_HIT: Final[Query] = Query("SELECT player.rate_limit_hit(%s, %s, %s)")

# What the site lists: devices that are not revoked. One never used within 24 hours of pairing
# counts as deleted (auth_enter_device answers `unknown` for it), so it is not listed.
LIST_DEVICES: Final[Query] = Query(
    """
SELECT id, name, platform, version, created_at, last_used_at
FROM player.devices
WHERE account_id = %s
  AND revoked_at IS NULL
  AND (last_used_at IS NOT NULL OR created_at > now() - interval '24 hours')
ORDER BY created_at DESC, id
"""
)

# The devices that count towards the cap of 10: the same rule as in auth_decide_pairing.
COUNT_ACTIVE_DEVICES: Final[Query] = Query(
    """
SELECT count(*)
FROM player.devices
WHERE account_id = %s
  AND revoked_at IS NULL
  AND coalesce(last_used_at, created_at) > now() - interval '180 days'
  AND (last_used_at IS NOT NULL OR created_at > now() - interval '24 hours')
"""
)

ONE_DEVICE: Final[Query] = Query(
    """
SELECT name, platform, version, created_at
FROM player.devices
WHERE account_id = %s AND id = %s AND revoked_at IS NULL
"""
)

# Revoking sets revoked_at: the row stays, so that the token is answered `token_revoked`.
REVOKE_DEVICE: Final[Query] = Query(
    """
UPDATE player.devices SET revoked_at = now()
WHERE account_id = %s AND id = %s AND revoked_at IS NULL
RETURNING id
"""
)

# Section 11. The acting credential is the request's: a site session, or the device itself.
ADD_DEVICE_EVENT: Final[Query] = Query(
    """
INSERT INTO player.audit_events
  (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
VALUES (%s, %s, %s, %s, %s::cidr, %s, %s::jsonb)
"""
)
