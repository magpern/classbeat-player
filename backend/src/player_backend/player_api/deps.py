"""The dependency of the device token (ADR 0002, sections 6, 9 and 10, "In FastAPI").

`device_token` is the one dependency of the device credential: it takes the token from
`Authorization: Bearer` (never a cookie), opens the request's transaction, calls
`auth_enter_device` as its first statement and yields the `AccountContext`. A token that sets
no account is answered after its transaction has been committed, so its counters stay.
"""

from __future__ import annotations

import time
from collections.abc import Generator
from typing import Annotated, Final, cast

from fastapi import Depends, Request

from player_backend.bearer_blocks import BearerBlocks
from player_backend.bearer_policy import (
    REFUSAL_CODES,
    REQUEST_WINDOW,
    SAME_TOKEN_WINDOW,
    UNKNOWN_WINDOW,
    bearer_device_token,
    requests_key,
    same_token_key,
    unknown_tokens_key,
)
from player_backend.db import devices
from player_backend.db.context import AccountContext
from player_backend.http_errors import ApiError
from player_backend.login_policy import retry_after
from player_backend.site.deps import TheCaller
from player_backend.site.state import site_state
from player_backend.token_policy import token_hash

_CHALLENGE: Final = {"WWW-Authenticate": "Bearer"}


def bearer_blocks(request: Request) -> BearerBlocks:
    return cast(BearerBlocks, request.app.state.bearer_blocks)


def _limited(seconds: int) -> ApiError:
    return ApiError(429, "too_many_requests", {"Retry-After": str(seconds)})


def device_token(request: Request, who: TheCaller) -> Generator[AccountContext]:
    token = bearer_device_token(request.headers.get("authorization"))
    if token is None:
        # Refused by its shape, before any lookup: no token, another type, another scheme.
        raise ApiError(401, "invalid_token", _CHALLENGE)
    digest = token_hash(token)
    keys = devices.BearerKeys(
        same_token=same_token_key(digest, who.address_hash),
        unknown_tokens=unknown_tokens_key(who.address_hash),
        requests=requests_key(digest),
    )
    blocks = bearer_blocks(request)
    now = time.time()
    left = blocks.seconds_left(keys.same_token, now)
    if left is not None:
        # Section 10: this token from this address is refused without a lookup.
        raise _limited(left)
    with devices.entered(site_state(request).pool, digest, keys) as entry:
        if isinstance(entry, AccountContext):
            yield entry
            return
        refused = entry
    # Reached only for a refusal, after its transaction has been committed.
    if refused.state == "limited":
        raise _limited(retry_after(now, REQUEST_WINDOW))
    if refused.same_token_over:
        blocks.block(keys.same_token, now + SAME_TOKEN_WINDOW.total_seconds(), now)
        raise _limited(int(SAME_TOKEN_WINDOW.total_seconds()))
    if refused.unknown_over:
        raise _limited(retry_after(now, UNKNOWN_WINDOW))
    raise ApiError(401, REFUSAL_CODES[refused.state], _CHALLENGE)


DeviceToken = Annotated[AccountContext, Depends(device_token, scope="function")]
