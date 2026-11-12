"""Data access of devices and the device token (ADR 0002, sections 6, 9, 10 and 11).

`entered` is the request's transaction for a device token: `auth_enter_device` is its first
statement. Everything else takes the `AccountContext` of a request (a site session's, or the
device's own) and filters by its account in the code.
"""

from __future__ import annotations

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from player_backend.bearer_policy import (
    COUNTED_PER_TOKEN,
    REQUEST_MAX,
    REQUEST_WINDOW,
    SAME_TOKEN_MAX,
    SAME_TOKEN_WINDOW,
    UNKNOWN_MAX,
    UNKNOWN_WINDOW,
    DeviceRefusal,
)
from player_backend.client_policy import ClientInfo
from player_backend.db.context import AccountContext
from player_backend.db.executor import Handle, Pool
from player_backend.db.queries import devices as q

# Section 11. The detail says what ends with the device (section 8).
REVOKED = "device.revoked"


@dataclass(frozen=True)
class Refused:
    """A device token that sets no account, and what its counters said."""

    state: DeviceRefusal | Literal["limited"]
    # The same token from this address is over its limit: refuse it without a lookup now.
    same_token_over: bool = False
    # This address is over its limit of unknown tokens.
    unknown_over: bool = False


@dataclass(frozen=True)
class BearerKeys:
    """The counters' keys of one request (bearer_policy.py)."""

    same_token: bytes
    unknown_tokens: bytes
    requests: bytes


@dataclass(frozen=True)
class DeviceInfo:
    id: UUID
    name: str
    platform: str
    version: str
    paired_at: datetime
    last_used_at: datetime | None


def _over(db: Handle, key: bytes, window: object, limit: int) -> bool:
    return db.rows(q.LIMIT_HIT, (key, window, limit))[0][0] is not False


@contextmanager
def entered(pool: Pool, token_hash: bytes, keys: BearerKeys) -> Generator[AccountContext | Refused]:
    """The transaction of a device-token request, or why the token sets no account.

    Committed when the block ends, rolled back when it raises. For a `Refused` the caller
    leaves the block first and raises after it, so that what was counted stays counted; for a
    route that refuses the request it does the same (`undone_on_error`, db/context.py).
    """
    with pool.handle() as db, db.transaction():
        found = db.rows(q.ENTER_DEVICE, (token_hash,))
        current = db.rows(q.CURRENT_ACCOUNT)
        device_id, state = found[0] if len(found) == 1 else (None, None)
        account_id, now = current[0]
        if state == "ok":
            if not (
                isinstance(device_id, UUID)
                and isinstance(account_id, UUID)
                and isinstance(now, datetime)
            ):
                yield Refused("unknown")
            elif _over(db, keys.requests, REQUEST_WINDOW, REQUEST_MAX):
                yield Refused("limited")
            else:
                yield AccountContext(
                    account_id=account_id,
                    credential_kind="device",
                    credential_id=device_id,
                    signed_in_at=None,
                    entered_at=now,
                    db=db,
                )
            return
        # Anything that is not a known state is treated as no such token.
        refusal: DeviceRefusal = (
            "revoked" if state == "revoked" else "expired" if state == "expired" else "unknown"
        )
        # The address's counter first. An address over its limit of unknown tokens is refused
        # by that alone, and gets no counter row of its own for each further token it makes up.
        unknown_over = refusal == "unknown" and _over(
            db, keys.unknown_tokens, UNKNOWN_WINDOW, UNKNOWN_MAX
        )
        same_token_over = (
            not unknown_over
            and refusal in COUNTED_PER_TOKEN
            and _over(db, keys.same_token, SAME_TOKEN_WINDOW, SAME_TOKEN_MAX)
        )
        yield Refused(refusal, same_token_over=same_token_over, unknown_over=unknown_over)


def list_devices(ctx: AccountContext) -> list[DeviceInfo]:
    """The account's devices that are not revoked, the most recently paired first."""
    return [
        DeviceInfo(
            cast(UUID, device_id),
            cast(str, name),
            cast(str, platform),
            cast(str, version),
            cast(datetime, created_at),
            cast("datetime | None", last_used_at),
        )
        for device_id, name, platform, version, created_at, last_used_at in ctx.db.rows(
            q.LIST_DEVICES, (ctx.account_id,)
        )
    ]


def count_active(ctx: AccountContext) -> int:
    """How many of the account's devices count towards the cap."""
    return int(str(ctx.db.rows(q.COUNT_ACTIVE_DEVICES, (ctx.account_id,))[0][0]))


def own_device(ctx: AccountContext) -> DeviceInfo | None:
    """The device of a device-token request: its own row and nothing else of the account."""
    if ctx.credential_kind != "device":
        return None
    found = ctx.db.rows(q.ONE_DEVICE, (ctx.account_id, ctx.credential_id))
    if len(found) != 1:
        return None
    name, platform, version, created_at = found[0]
    return DeviceInfo(
        ctx.credential_id,
        cast(str, name),
        cast(str, platform),
        cast(str, version),
        cast(datetime, created_at),
        None,
    )


def revoke(ctx: AccountContext, device_id: UUID, client: ClientInfo) -> bool:
    """Revoke one device of the account. False when the account has no such live device."""
    if not ctx.db.rows(q.REVOKE_DEVICE, (ctx.account_id, device_id)):
        return False
    detail = {"device_id": str(device_id), "live_sessions": "ended"}
    ctx.db.rows(
        q.ADD_DEVICE_EVENT,
        (
            ctx.account_id,
            REVOKED,
            ctx.credential_kind,
            ctx.credential_id,
            client.network,
            client.family,
            json.dumps(detail),
        ),
    )
    return True
