"""SQL of site sessions (player_backend/db/site_sessions.py). Every statement on a tenant table
filters by the account in the code; the policy is the backstop (ADR 0002, section 9)."""

from typing import Final

from player_backend.db.executor import Query

# The first statement of a signed-in request's transaction.
ENTER_SESSION: Final[Query] = Query(
    "SELECT session_id, signed_in_at FROM player.auth_enter_session(%s)"
)

# The account the function set for this transaction, and the transaction's time.
CURRENT_ACCOUNT: Final[Query] = Query(
    "SELECT nullif(current_setting('app.account_id', true), '')::uuid, now()"
)

# Live sessions only: the same two limits as auth_enter_session.
LIST_SESSIONS: Final[Query] = Query(
    """
SELECT id, client_family, created_at, last_used_at
FROM player.sessions
WHERE account_id = %s
  AND last_used_at > now() - interval '14 days'
  AND created_at > now() - interval '60 days'
ORDER BY last_used_at DESC, id
"""
)

END_SESSION: Final[Query] = Query(
    "DELETE FROM player.sessions WHERE account_id = %s AND id = %s RETURNING id"
)

END_ALL_SESSIONS: Final[Query] = Query(
    "DELETE FROM player.sessions WHERE account_id = %s RETURNING id"
)

# Section 11. The acting credential is the session of the request.
ADD_SESSION_EVENT: Final[Query] = Query(
    """
INSERT INTO player.audit_events
  (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
VALUES (%s, %s, 'session', %s, %s::cidr, %s, %s::jsonb)
"""
)
