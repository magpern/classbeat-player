"""SQL of source links and the source token (player_backend/db/sources.py). Every statement on a
tenant table filters by the account in the code; the policy is the backstop (ADR 0002, s. 9)."""

from typing import Final

from player_backend.db.executor import Query

# The first statement of a source-token request's transaction. One row, or none.
ENTER_SOURCE: Final[Query] = Query("SELECT link_id, source_id FROM player.auth_enter_source(%s)")

# The account the function set for this transaction, and the transaction's time.
CURRENT_ACCOUNT: Final[Query] = Query(
    "SELECT nullif(current_setting('app.account_id', true), '')::uuid, now()"
)

# Section 10: the counters. True when over the limit.
LIMIT_HIT: Final[Query] = Query("SELECT player.rate_limit_hit(%s, %s, %s)")

# For the account already set: the code of an approved link.
NEW_LINK_CODE: Final[Query] = Query("SELECT player.auth_new_link_code(%s, %s, %s, %s)")

EXCHANGE_LINK_CODE: Final[Query] = Query(
    "SELECT player.auth_exchange_link_code("
    "%s, %s, %s, %s, %s, ROW(%s::cidr, %s)::player.client_info)"
)

# The links that count, and are listed: used, or made, within the last 365 days. An idle one
# counts as ended (auth_enter_source refuses it).
LIST_LINKS: Final[Query] = Query(
    """
SELECT id, source_id, created_at, last_used_at
FROM player.source_links
WHERE account_id = %s
  AND coalesce(last_used_at, created_at) > now() - interval '365 days'
ORDER BY created_at DESC, id
"""
)

# Revoking deletes the row: the token is unknown from the next request on. The classes stay.
REVOKE_LINK: Final[Query] = Query(
    """
DELETE FROM player.source_links
WHERE account_id = %s AND id = %s
RETURNING source_id
"""
)

# The address the notice of a new link goes to.
ACCOUNT_EMAIL: Final[Query] = Query("SELECT email FROM player.accounts WHERE id = %s")

# Section 11. The acting credential is the request's: a site session, or the source itself.
ADD_SOURCE_EVENT: Final[Query] = Query(
    """
INSERT INTO player.audit_events
  (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
VALUES (%s, %s, %s, %s, %s::cidr, %s, %s::jsonb)
"""
)
