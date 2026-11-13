"""SQL of the revocation notice (player_backend/db/revocation.py): ADR 0002, section 8, and ADR
0005, section 2. The channel's name is fixed here; the payload is the account id as text."""

from typing import Final

from player_backend.db.executor import Query

# Sent by PostgreSQL only when the transaction commits; a rolled-back one sends nothing.
NOTIFY: Final[Query] = Query("SELECT pg_notify('live_revocations', %s::uuid::text)")
