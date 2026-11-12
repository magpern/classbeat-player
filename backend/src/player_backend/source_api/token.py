"""The code exchange (ADR 0002, section 7, step 5): `POST /api/source/token`.

The source's server sends the link code, its source id, the redirect address and the PKCE
verifier in the body. The route takes no other credential and reads no cookie. The source token
is returned once and is never stored in the clear. Exchanges are counted per address (section
10): 10 a minute.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from player_backend.db import sources
from player_backend.http_errors import ApiError, error_response
from player_backend.login_policy import retry_after
from player_backend.site.deps import TheCaller
from player_backend.site.state import site_state
from player_backend.source_policy import EXCHANGE_MAX, EXCHANGE_WINDOW, exchange_limit_key
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token, token_hash

router = APIRouter()


class CodeExchange(BaseModel):
    source: str = Field(max_length=40)
    code: str = Field(max_length=200)
    redirect_uri: str = Field(max_length=2000)
    code_verifier: str = Field(max_length=200)


def _invalid() -> JSONResponse:
    # One answer for every refusal: unknown, used, expired, a wrong binding, the cap of links.
    return error_response(400, "invalid_grant")


@router.post("/token")
def exchange(body: CodeExchange, request: Request, who: TheCaller) -> JSONResponse:
    if not is_token("lc", body.code):
        # Not a link code: refused by its shape, before any lookup.
        return _invalid()
    state = site_state(request)
    allowed = sources.exchange_allowed(
        state.pool,
        address_key=exchange_limit_key(who.address_hash),
        window=EXCHANGE_WINDOW,
        max_hits=EXCHANGE_MAX,
    )
    if not allowed:
        after = retry_after(time.time(), EXCHANGE_WINDOW)
        raise ApiError(429, "too_many_requests", {"Retry-After": str(after)})
    # Made for every exchange and kept by nobody unless this exchange makes the link.
    source_token = new_token("src")
    linked = sources.exchange(
        state.pool,
        code_hash=token_hash(body.code),
        source_id=body.source,
        redirect_uri=body.redirect_uri,
        verifier=body.code_verifier,
        token_hash=token_hash(source_token),
        client=who.info,
    )
    if not linked:
        return _invalid()
    return JSONResponse({"source_token": source_token, "token_type": "Bearer"})
