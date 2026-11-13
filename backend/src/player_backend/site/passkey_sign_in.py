"""Passkey sign-in (ADR 0002, section 4): ask for a challenge, then answer it.

Neither route takes a session or an email, and the challenge's options list no credentials: the
browser offers the passkeys it has. Both read the browser token's cookie, which binds the
challenge to the browser that asked. A refused sign-in is counted per address (section 10)
and answered the same way whatever was wrong; over the limit the answer is 429.
"""

from __future__ import annotations

import secrets
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from player_backend.db import passkey_login
from player_backend.http_errors import ApiError
from player_backend.login_policy import retry_after
from player_backend.passkey_policy import (
    CHALLENGE_BYTES,
    FAILED_MAX,
    FAILED_WINDOW,
    challenge_hash,
    challenge_of,
    credential_id_of,
    failed_limit_key,
)
from player_backend.site.cookies import login_cookie_token, put_login_cookie, put_session_cookie
from player_backend.site.deps import TheCaller
from player_backend.site.state import site_state
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash
from player_backend.webauthn_check import sign_in_options, verified_sign_in

router = APIRouter()

BrowserToken = Annotated[str | None, Depends(login_cookie_token)]


class AssertionResponse(BaseModel):
    clientDataJSON: str = Field(max_length=4096)
    authenticatorData: str = Field(max_length=4096)
    signature: str = Field(max_length=2048)
    userHandle: str | None = Field(default=None, max_length=512)


class Assertion(BaseModel):
    """What `navigator.credentials.get()` gave, in WebAuthn's JSON form."""

    id: str = Field(max_length=1400)
    rawId: str = Field(max_length=1400)
    type: str = Field(max_length=40)
    response: AssertionResponse
    authenticatorAttachment: str | None = Field(default=None, max_length=40)


class PasskeySignIn(BaseModel):
    credential: Assertion


@router.post("/sign-in/passkey/options")
def options(request: Request, browser: BrowserToken) -> JSONResponse:
    """A new challenge for this browser, replacing its older one, and the options to use it."""
    state = site_state(request)
    browser_token = browser or new_token("lgn")
    challenge = secrets.token_bytes(CHALLENGE_BYTES)
    passkey_login.new_challenge(
        state.pool, challenge_hash=challenge_hash(challenge), browser_hash=token_hash(browser_token)
    )
    response = JSONResponse(sign_in_options(state.settings.site_origin, challenge=challenge))
    if browser is None:
        put_login_cookie(response, browser_token)
    return response


@router.post("/sign-in/passkey")
def sign_in(
    body: PasskeySignIn, request: Request, who: TheCaller, browser: BrowserToken
) -> JSONResponse:
    """Answer a challenge with a passkey. Issues a new session."""
    state = site_state(request)
    origin = state.settings.site_origin
    credential = body.credential.model_dump(exclude_none=True)
    challenge = challenge_of(body.credential.response.clientDataJSON)

    def verify(public_key: bytes) -> int | None:
        if challenge is None:
            return None
        return verified_sign_in(origin, credential, challenge, public_key)

    session_token = new_token("ses")
    # Without the browser's own token nothing can match: a token made here is in no challenge.
    browser_token = browser or new_token("lgn")
    outcome = passkey_login.sign_in(
        state.pool,
        failed_key=failed_limit_key(who.address_hash),
        failed_window=FAILED_WINDOW,
        failed_max=FAILED_MAX,
        credential_id=credential_id_of(body.credential.rawId),
        challenge_hash=None if challenge is None else challenge_hash(challenge),
        browser_hash=token_hash(browser_token),
        session_hash=token_hash(session_token),
        client=who.info,
        verify=verify,
    )
    if outcome == "limited":
        after = retry_after(time.time(), FAILED_WINDOW)
        raise ApiError(429, "too_many_requests", {"Retry-After": str(after)})
    if outcome != "signed_in":
        # One answer for every refusal: an unknown passkey, a bad signature, a used, expired
        # or other browser's challenge, and the counter rule.
        raise ApiError(401, "sign_in_refused")
    response = JSONResponse({"status": "signed_in"})
    put_session_cookie(response, session_token)
    return response
