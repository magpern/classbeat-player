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

# ADR 0010, section 8: `account link`. The tenant policy lets player_owner (the tables' owner,
# under FORCE ROW LEVEL SECURITY) reach the one account set for the transaction, and no other.
SET_ACCOUNT: Final[Query] = Query("SELECT set_config('app.account_id', %s, true)")
LINK_ACCOUNT: Final[Query] = Query(
    "UPDATE player.accounts SET kind = 'instructor', classbeat_issuer = %s, "
    "classbeat_subject = %s WHERE id = %s AND kind = 'unlinked' RETURNING id"
)
DELETE_ACCOUNT_PASSKEYS: Final[Query] = Query(
    "DELETE FROM player.passkeys WHERE account_id = %s RETURNING id"
)
# The event holds no identity: the subject is never in an audit event (ADR 0010, section 9).
ACCOUNT_LINKED_EVENT: Final[Query] = Query(
    "INSERT INTO player.audit_events (account_id, event, detail) "
    "VALUES (%s, 'account.linked', jsonb_build_object('by', 'operator', 'passkeys_deleted', %s))"
)
# ADR 0010, section 8: `account delete`, as ADR 0002, section 12 deletes an account, with the
# account's `live_revocations` notice in the same transaction.
DELETE_ACCOUNT: Final[Query] = Query("DELETE FROM player.accounts WHERE id = %s RETURNING id")
NOTIFY_REVOKED: Final[Query] = Query("SELECT pg_notify('live_revocations', %s::uuid::text)")
