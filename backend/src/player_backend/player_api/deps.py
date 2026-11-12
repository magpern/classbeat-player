"""The dependency of the device token (ADR 0002, sections 6, 9 and 10, "In FastAPI").

`app_only` is the check of the app's routes that take no credential (pairing): no request of a
page in a browser, and a body sent as JSON. It runs before anything is counted or looked up.

`device_token` is the one dependency of the device credential: it takes the token from
`Authorization: Bearer` (never a cookie), opens the request's transaction, calls
`auth_enter_device` as its first statement and yields the `AccountContext`. A token that sets
no account is answered after its transaction has been committed, so its counters stay. A route
that refuses the request (an `ApiError`: a 404) has its own writes rolled back, and the count
of the token's requests and the device's "last used" kept: the token was used. Any other error
rolls back all. The same shape as `site_session` (site/deps.py).
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
from player_backend.db.context import AccountContext, undone_on_error
from player_backend.http_errors import ApiError
from player_backend.login_policy import retry_after
from player_backend.request_policy import app_request_refusal
from player_backend.site.deps import TheCaller
from player_backend.site.state import site_state
from player_backend.token_policy import token_hash

_CHALLENGE: Final = {"WWW-Authenticate": "Bearer"}


def bearer_blocks(request: Request) -> BearerBlocks:
    return cast(BearerBlocks, request.app.state.bearer_blocks)


def app_only(request: Request) -> None:
    """Refuse what is not the desktop app's own request (request_policy.py).

    A dependency of the router, so it runs for every route of it, before the route's function
    and so before anything is counted, looked up or written.
    """
    refusal = app_request_refusal(
        request.headers.get("sec-fetch-site"), request.headers.get("content-type")
    )
    if refusal == "browser":
        raise ApiError(403, "cross_site_request")
    if refusal is not None:
        raise ApiError(415, "unsupported_media_type")


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
    refused: devices.Refused | None = None
    refusal: ApiError | None = None
    with devices.entered(site_state(request).pool, digest, keys) as entry:
        if isinstance(entry, AccountContext):
            try:
                # What the route wrote is undone when it refuses, and nothing else is.
                with undone_on_error(entry):
                    yield entry
            except ApiError as error:
                refusal = error
        else:
            refused = entry
    # From here on the transaction has been committed: the counters and "last used" stay.
    if refusal is not None:
        raise refusal
    if refused is None:
        return
    if refused.state == "limited":
        raise _limited(retry_after(now, REQUEST_WINDOW))
    if refused.same_token_over:
        blocks.block(keys.same_token, now + SAME_TOKEN_WINDOW.total_seconds(), now)
        raise _limited(int(SAME_TOKEN_WINDOW.total_seconds()))
    if refused.unknown_over:
        raise _limited(retry_after(now, UNKNOWN_WINDOW))
    raise ApiError(401, REFUSAL_CODES[refused.state], _CHALLENGE)


DeviceToken = Annotated[AccountContext, Depends(device_token, scope="function")]
