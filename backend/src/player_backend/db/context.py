"""`AccountContext`: what a request holds once its credential has been checked (ADR 0002, s. 9).

Made only after an `auth_enter_*` function has set the account as the first statement of the
request's transaction. Data access takes it: the account to filter by, and the handle of that
transaction. Nothing hands out a database connection.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from player_backend.db.executor import Handle


@dataclass(frozen=True)
class AccountContext:
    account_id: UUID
    credential_kind: Literal["session"]
    credential_id: UUID
    # When the user last proved who they are, and the time of this request's transaction: both
    # by the database's clock.
    signed_in_at: datetime
    entered_at: datetime
    db: Handle
