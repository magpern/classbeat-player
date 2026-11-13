"""SQL of an account's passkeys (player_backend/db/passkeys.py). Every statement on a tenant
table filters by the account in the code; the policy is the backstop (ADR 0002, section 9).

No statement returns a public key to the site, and none takes or returns a challenge but by its
hash.
"""

from typing import Final

from player_backend.db.executor import Query

LIST_PASSKEYS: Final[Query] = Query(
    """
SELECT id, name, created_at, last_used_at
FROM player.passkeys
WHERE account_id = %s
ORDER BY created_at, id
"""
)

COUNT_PASSKEYS: Final[Query] = Query(
    "SELECT count(*)::int FROM player.passkeys WHERE account_id = %s"
)

# What the registration options name: the account, and its passkeys to exclude.
ACCOUNT_USER: Final[Query] = Query(
    "SELECT email, passkey_user_handle FROM player.accounts WHERE id = %s"
)
CREDENTIAL_IDS: Final[Query] = Query(
    "SELECT credential_id FROM player.passkeys WHERE account_id = %s ORDER BY created_at, id"
)

# One registration at a time per session; expired ones of the account go too (no function
# purges this tenant table).
DROP_REGISTRATIONS: Final[Query] = Query(
    """
DELETE FROM player.passkey_registrations
WHERE account_id = %s AND (session_id = %s OR expires_at <= now())
"""
)
# Section 4: a registration challenge lives 5 minutes and is bound to the session.
NEW_REGISTRATION: Final[Query] = Query(
    """
INSERT INTO player.passkey_registrations (account_id, session_id, challenge_hash, expires_at)
VALUES (%s, %s, %s, now() + interval '5 minutes')
"""
)
# Single use: the row is gone whatever the check of the credential says next.
USE_REGISTRATION: Final[Query] = Query(
    """
DELETE FROM player.passkey_registrations
WHERE account_id = %s AND session_id = %s AND challenge_hash = %s AND expires_at > now()
RETURNING id
"""
)

# The account's additions are taken one at a time, so the cap of 10 holds when two happen at
# once. The backend's role may not lock the account's row (it has no UPDATE on accounts).
LOCK_ADDITIONS: Final[Query] = Query(
    "SELECT pg_advisory_xact_lock(7270011, ('x' || left(replace(%s::text, '-', ''), 8))"
    "::bit(32)::integer)"
)

# A credential id held by any account, this one or another, adds nothing.
ADD_PASSKEY: Final[Query] = Query(
    """
INSERT INTO player.passkeys (account_id, credential_id, public_key, sign_count, transports, name)
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (credential_id) DO NOTHING
RETURNING id, name, created_at, last_used_at
"""
)

# A rename is the same row written again with its new name, in one statement: the backend's
# role has no UPDATE on passkeys (ADR 0002, section 9, its grants). Id, key, counter,
# transports and dates are kept as they are.
RENAME_PASSKEY: Final[Query] = Query(
    """
WITH gone AS (
  DELETE FROM player.passkeys WHERE account_id = %s AND id = %s
  RETURNING id, account_id, credential_id, public_key, sign_count, transports, created_at,
            last_used_at
)
INSERT INTO player.passkeys
  (id, account_id, credential_id, public_key, sign_count, transports, name, created_at,
   last_used_at)
SELECT g.id, g.account_id, g.credential_id, g.public_key, g.sign_count, g.transports, %s,
       g.created_at, g.last_used_at
FROM gone g
RETURNING id, name, created_at, last_used_at
"""
)

REMOVE_PASSKEY: Final[Query] = Query(
    "DELETE FROM player.passkeys WHERE account_id = %s AND id = %s RETURNING id"
)

# Section 11. The acting credential is the session of the request.
ADD_PASSKEY_EVENT: Final[Query] = Query(
    """
INSERT INTO player.audit_events
  (account_id, event, credential_kind, credential_id, client_network, client_family, detail)
VALUES (%s, %s, 'session', %s, %s::cidr, %s, %s::jsonb)
"""
)
