"""SQL of the account's export and deletion (player_backend/db/account.py). Every statement on a
tenant table filters by the account in the code; the policy is the backstop (ADR 0002, s. 9).

The export names its columns one by one: no `*`, so no hash, token, key, account id or passkey
user handle can come in with a later column.
"""

from typing import Final

from player_backend.db.executor import Query

LIMIT_HIT: Final[Query] = Query("SELECT player.rate_limit_hit(%s, %s, %s)")

ACCOUNT: Final[Query] = Query("SELECT email, created_at FROM player.accounts WHERE id = %s")

# One page of the export's classes: committed classes and the markers of removed ones, after a
# sync position, in sync order (the placeholder, number 0, is no class and has no position).
# The page size is the export's constant, passed as the limit.
CLASS_PAGE: Final[Query] = Query(
    """
SELECT source_id, source_class_id, publication_number, kind, published_at, document,
       sync_position
FROM player.classes
WHERE account_id = %s AND publication_number > 0 AND sync_position > %s
ORDER BY sync_position
LIMIT %s
"""
)

DEVICES: Final[Query] = Query(
    """
SELECT id, name, platform, version, created_at, last_used_at, revoked_at
FROM player.devices
WHERE account_id = %s
ORDER BY created_at, id
"""
)

SOURCE_LINKS: Final[Query] = Query(
    """
SELECT id, source_id, created_at, last_used_at
FROM player.source_links
WHERE account_id = %s
ORDER BY created_at, id
"""
)

PASSKEYS: Final[Query] = Query(
    """
SELECT name, created_at, last_used_at
FROM player.passkeys
WHERE account_id = %s
ORDER BY created_at, id
"""
)

SESSIONS: Final[Query] = Query(
    """
SELECT id, client_family, signed_in_at, created_at, last_used_at
FROM player.sessions
WHERE account_id = %s
ORDER BY created_at, id
"""
)

EVENTS: Final[Query] = Query(
    """
SELECT occurred_at, event, credential_kind, credential_id, client_network::text, client_family,
       detail
FROM player.audit_events
WHERE account_id = %s
ORDER BY occurred_at, id
"""
)

# Section 11, "export made". The acting credential is the session of the request.
ADD_EVENT: Final[Query] = Query(
    """
INSERT INTO player.audit_events
  (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
VALUES (%s, %s, 'session', %s, %s::cidr, %s, '{}'::jsonb)
"""
)

# Section 12: the account row, and by cascade everything it owns, in the request's transaction.
DELETE_ACCOUNT: Final[Query] = Query("DELETE FROM player.accounts WHERE id = %s RETURNING id")
