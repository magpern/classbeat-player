"""The dependency of the source token (ADR 0002, sections 7, 9 and 10, "In FastAPI").

`source_token` is the one dependency of the source credential: it takes the token from
`Authorization: Bearer` (never a cookie), opens the request's transaction, calls
`auth_enter_source` as its first statement and yields the `SourceEntry` (the account context and
the token's source id). A token that sets no account is answered after its transaction has been
committed, so its counters stay.

A route that refuses the request (an `ApiError`) has its own writes undone and the request's
count and the link's "last used" kept. An `AuditedRefusal` (a refused publication) is also
recorded: in a second transaction of the same request, which enters the account again with
`auth_enter_source` (section 7). Any other error rolls back all.
"""

from __future__ import annotations

import time
from collections.abc import Generator, Mapping
from typing import Annotated, Final

from fastapi import Depends, Request

from player_backend.bearer_policy import (
    SAME_TOKEN_WINDOW,
    UNKNOWN_WINDOW,
    same_token_key,
    unknown_tokens_key,
)
from player_backend.db import sources
from player_backend.db.context import undone_on_error
from player_backend.http_errors import ApiError
from player_backend.login_policy import retry_after
from player_backend.player_api.deps import bearer_blocks
from player_backend.site.deps import Caller, TheCaller
from player_backend.site.state import site_state
from player_backend.source_policy import REQUEST_WINDOW, bearer_source_token, requests_key
from player_backend.token_policy import token_hash

_CHALLENGE: Final = {"WWW-Authenticate": "Bearer"}


class AuditedRefusal(ApiError):
    """A refusal that the account's audit events record (section 11)."""

    def __init__(
        self,
        status: int,
        code: str,
        event: str,
        detail: Mapping[str, object],
        extra: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(status, code, extra=extra)
        self.event = event
        self.detail = dict(detail)


def _limited(seconds: int) -> ApiError:
    return ApiError(429, "too_many_requests", {"Retry-After": str(seconds)})


def _record(request: Request, digest: bytes, refusal: AuditedRefusal, who: Caller) -> None:
    with sources.entered_again(site_state(request).pool, digest) as again:
        if again is not None:
            sources.add_event(again.context, refusal.event, who.info, refusal.detail)


def source_token(request: Request, who: TheCaller) -> Generator[sources.SourceEntry]:
    token = bearer_source_token(request.headers.get("authorization"))
    if token is None:
        # Refused by its shape, before any lookup: no token, another type, another scheme.
        raise ApiError(401, "invalid_token", _CHALLENGE)
    digest = token_hash(token)
    keys = sources.SourceKeys(
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
    refused: sources.Refused | None = None
    refusal: ApiError | None = None
    with sources.entered(site_state(request).pool, digest, keys) as entry:
        if isinstance(entry, sources.SourceEntry):
            try:
                # What the route wrote is undone when it refuses, and nothing else is.
                with undone_on_error(entry.context):
                    yield entry
            except ApiError as error:
                refusal = error
        else:
            refused = entry
    # From here on the transaction has been committed: the counters and "last used" stay.
    if refusal is not None:
        if isinstance(refusal, AuditedRefusal):
            _record(request, digest, refusal, who)
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
    raise ApiError(401, "token_unknown", _CHALLENGE)


SourceToken = Annotated[sources.SourceEntry, Depends(source_token, scope="function")]
