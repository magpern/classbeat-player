"""Pairing as the app sees it (ADR 0002, section 6): start a pairing, and poll for the token.

Neither route takes a credential but the device code, in the body of a POST. No cookie is
read. The device token is returned once, by the first poll after the approval, and is never
stored in the clear.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from player_backend.code_issue import new_code
from player_backend.code_policy import code_hash, show_code
from player_backend.db import pairing
from player_backend.http_errors import ApiError, error_response
from player_backend.login_policy import retry_after
from player_backend.pairing_policy import (
    EXPIRES_IN,
    INTERVAL,
    POLL_OK,
    START_MAX,
    START_TRIES,
    START_WINDOW,
    clean_label,
    paired_mail,
    pairing_page,
    poll_refusal,
    start_limit_key,
)
from player_backend.site.deps import TheCaller
from player_backend.site.state import site_state
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token, token_hash

router = APIRouter(prefix="/api/pairing")


class PairingStart(BaseModel):
    platform: str = Field(max_length=400)
    version: str = Field(max_length=400)


class PairingPoll(BaseModel):
    device_code: str = Field(max_length=200)


@router.post("/start")
def start(body: PairingStart, request: Request, who: TheCaller) -> JSONResponse:
    state = site_state(request)
    platform, version = clean_label(body.platform), clean_label(body.version)
    if platform is None or version is None:
        raise ApiError(422, "invalid_request")
    allowed = pairing.start_allowed(
        state.pool,
        address_key=start_limit_key(who.address_hash),
        window=START_WINDOW,
        max_starts=START_MAX,
    )
    if not allowed:
        after = retry_after(time.time(), START_WINDOW)
        raise ApiError(429, "too_many_requests", {"Retry-After": str(after)})
    for _ in range(START_TRIES):
        device_code, user_code = new_token("dc"), new_code()
        started = pairing.start(
            state.pool,
            device_code_hash=token_hash(device_code),
            user_code_hash=code_hash(user_code),
            platform=platform,
            version=version,
        )
        if started:
            return JSONResponse(
                {
                    "device_code": device_code,
                    "user_code": show_code(user_code),
                    "verification_uri": pairing_page(state.settings.site_origin),
                    "expires_in": EXPIRES_IN,
                    "interval": INTERVAL,
                }
            )
    # Every new code was in use by another pairing: not something a client can cause.
    raise ApiError(503, "try_again")


@router.post("/token")
def token(body: PairingPoll, request: Request, who: TheCaller) -> JSONResponse:
    if not is_token("dc", body.device_code):
        # Not a device code: refused by its shape, before any lookup.
        return error_response(400, "expired_token")
    state = site_state(request)
    # Made for every poll and kept by nobody unless this poll is the one that collects.
    device_token = new_token("dev")
    outcome, email = pairing.collect(
        state.pool,
        device_code_hash=token_hash(body.device_code),
        device_token_hash=token_hash(device_token),
        client=who.info,
    )
    if outcome != POLL_OK or not isinstance(email, str):
        return error_response(400, poll_refusal(outcome))
    response = JSONResponse({"device_token": device_token, "email": email})
    # Section 6: the account is told, after the response.
    mail = paired_mail(state.settings.site_origin, email)
    response.background = BackgroundTask(state.mailer.send, mail)
    return response
