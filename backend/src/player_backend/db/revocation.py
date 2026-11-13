"""The `live_revocations` notice of the revoking transactions (ADR 0002, section 8; ADR 0005,
section 2).

A transaction that revokes a device, ends site sessions or deletes an account calls `notify`
after its write, in the same transaction. PostgreSQL delivers the notice to listeners only when
that transaction commits, and never when it is rolled back. The notice is a hint and carries no
authority: the live process answers it by running its re-check (`auth_device_active`,
`auth_session_active`) for the account at once, and a missed one is caught by the re-check
every 30 seconds.
"""

from __future__ import annotations

from player_backend.db.context import AccountContext
from player_backend.db.queries import revocation as q

CHANNEL = "live_revocations"


def notify(ctx: AccountContext) -> None:
    """Queue the account's notice in the request's transaction, sent at its commit."""
    ctx.db.rows(q.NOTIFY, (ctx.account_id,))
