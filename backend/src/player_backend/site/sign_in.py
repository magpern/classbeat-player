"""Email link sign-in (ADR 0002, section 4): ask for a link, and use one.

Neither route takes a session. Both read the browser token's cookie, which proves only "the
same browser". The link token arrives in the body of a POST, never in a URL.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from player_backend.db import login
from player_backend.http_errors import ApiError
from player_backend.login_policy import (
    ADDRESS_MAX_REQUESTS,
    ADDRESS_WINDOW,
    address_limit_key,
    normalise_email,
    retry_after,
    sign_in_mail,
)
from player_backend.mail_delivery import deliver
from player_backend.passkey_policy import BUSY_RETRY_SECONDS
from player_backend.site.cookies import login_cookie_token, put_login_cookie, put_session_cookie
from player_backend.site.deps import TheCaller
from player_backend.site.state import site_state
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token, token_hash

router = APIRouter()

BrowserToken = Annotated[str | None, Depends(login_cookie_token)]


class LinkRequest(BaseModel):
    email: str = Field(max_length=1000)


class LinkUse(BaseModel):
    token: str = Field(max_length=200)


@router.post("/sign-in/link")
def request_link(
    body: LinkRequest, request: Request, who: TheCaller, browser: BrowserToken
) -> JSONResponse:
    """Always the same answer, whether or not the address can sign in (section 4, step 1)."""
    state = site_state(request)
    email = normalise_email(body.email)
    link_token = new_token("ml")
    browser_token = browser or new_token("lgn")
    outcome = login.request_link(
        state.pool,
        address_key=address_limit_key(who.address_hash),
        address_window=ADDRESS_WINDOW,
        address_max=ADDRESS_MAX_REQUESTS,
        email=email,
        link_hash=token_hash(link_token),
        browser_hash=token_hash(browser_token),
        address_hash=who.address_hash,
        client=who.info,
    )
    if outcome == "limited":
        # The only 429: it depends on the requester's address alone.
        raise ApiError(429, "too_many_requests", {"Retry-After": str(retry_after(time.time()))})
    if outcome == "invalid" or email is None:
        raise ApiError(422, "invalid_email")
    response = JSONResponse({"status": "accepted"})
    if browser is None:
        put_login_cookie(response, browser_token)
    if outcome == "mail":
        # Sent after the response, so the time taken tells nothing.
        mail = sign_in_mail(state.settings.site_origin, email, link_token)
        response.background = BackgroundTask(deliver, state.mailer, mail)
    return response


@router.post("/sign-in/complete")
def complete(
    body: LinkUse, request: Request, who: TheCaller, browser: BrowserToken
) -> JSONResponse:
    """Use a link: once, within 15 minutes, in the browser that asked. Issues a new session."""
    if not is_token("ml", body.token):
        raise ApiError(401, "sign_in_refused")
    session_token = new_token("ses")
    # Without the browser's own token nothing can match: a token made here is in no link.
    browser_token = browser or new_token("lgn")
    outcome = login.complete(
        site_state(request).pool,
        link_hash=token_hash(body.token),
        browser_hash=token_hash(browser_token),
        session_hash=token_hash(session_token),
        client=who.info,
    )
    if outcome == "busy":
        # The wait for the account's sign-in lock ran out (#158). Nothing was used up: the same
        # link can be sent again after `Retry-After`.
        raise ApiError(429, "too_many_requests", {"Retry-After": str(BUSY_RETRY_SECONDS)})
    if outcome != "signed_in":
        # One answer for every refusal: ask for a new link from this browser.
        raise ApiError(401, "sign_in_refused")
    response = JSONResponse({"status": "signed_in"})
    put_session_cookie(response, session_token)
    return response
