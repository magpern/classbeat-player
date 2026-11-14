"""Email link sign-in (ADR 0002, section 4): ask for a link, and use one.

Neither route takes a session. Both read the browser token's cookie, which proves only "the
same browser". The link token arrives in the body of a POST, never in a URL.

A link request may carry a return entry (ADR 0006): it is checked, put into the mailed link's
fragment and kept nowhere else, not in the database, the counters or the logs.
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
    is_return_entry,
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
    # Missing or null: none. Any string is accepted here and checked by `is_return_entry`, so
    # every string that is not a return entry gets the same `invalid_return`, in its order (after
    # the 429 and `invalid_email`). Its bound is `RETURN_MAX` there, for the same reason: a
    # `max_length` here would answer `invalid_request` before the requester's limit.
    return_to: str | None = None


class LinkUse(BaseModel):
    token: str = Field(max_length=200)


@router.post("/sign-in/link")
def request_link(
    body: LinkRequest, request: Request, who: TheCaller, browser: BrowserToken
) -> JSONResponse:
    """Always the same answer, whether or not the address can sign in (section 4, step 1).

    Answers in this order: the requester's own limit (429), the email, the return entry (422).
    Neither 422 depends on the email or the account, and neither makes the sign-in call.
    """
    state = site_state(request)
    email = normalise_email(body.email)
    return_to = body.return_to
    return_ok = return_to is None or is_return_entry(return_to)
    link_token = new_token("ml")
    browser_token = browser or new_token("lgn")
    outcome = login.request_link(
        state.pool,
        address_key=address_limit_key(who.address_hash),
        address_window=ADDRESS_WINDOW,
        address_max=ADDRESS_MAX_REQUESTS,
        # None stops before the sign-in call: the input is not valid, whichever part it is.
        email=email if return_ok else None,
        link_hash=token_hash(link_token),
        browser_hash=token_hash(browser_token),
        address_hash=who.address_hash,
        client=who.info,
    )
    if outcome == "limited":
        # The only 429: it depends on the requester's address alone.
        raise ApiError(429, "too_many_requests", {"Retry-After": str(retry_after(time.time()))})
    if email is None:
        raise ApiError(422, "invalid_email")
    # Here the two halves are one condition: `invalid` comes back only for `email=None`, and the
    # email check above has passed, so `invalid` means `not return_ok`. Both stay on purpose:
    # `not return_ok` does not rest on the data access, and an `invalid` from it is refused
    # whatever its cause (fail closed), never answered with `accepted`.
    if outcome == "invalid" or not return_ok:
        raise ApiError(422, "invalid_return")
    response = JSONResponse({"status": "accepted"})
    if browser is None:
        put_login_cookie(response, browser_token)
    if outcome == "mail":
        # Sent after the response, so the time taken tells nothing.
        mail = sign_in_mail(state.settings.site_origin, email, link_token, return_to)
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
