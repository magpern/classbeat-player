"""`AccountContext`: what a request holds once its credential has been checked (ADR 0002, s. 9).

Made only after an `auth_enter_*` function has set the account as the first statement of the
request's transaction. Data access takes it: the account to filter by, and the handle of that
transaction. Nothing hands out a database connection.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from player_backend.db.executor import Handle


@dataclass(frozen=True)
class AccountContext:
    account_id: UUID
    credential_kind: Literal["session", "device"]
    credential_id: UUID
    # When the user last proved who they are, and the time of this request's transaction: both
    # by the database's clock. A device token proves no sign-in: None.
    signed_in_at: datetime | None
    entered_at: datetime
    db: Handle


@contextmanager
def undone_on_error(ctx: AccountContext) -> Generator[None]:
    """A savepoint in the request's transaction: what the block wrote is undone when it raises.

    What the credential's `auth_enter_*` function and the request's counters wrote before it
    (a session's or a device's "last used", the count of a device token's requests) is not.
    """
    with ctx.db.transaction():
        yield
