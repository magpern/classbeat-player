"""Sign in with classbeat (ADR 0010, sections 2, 4, 5 and 6): start a flow, and its callback.

`start` is a script request under the site's origin rule. It reads the binding cookie (to drop
the browser's earlier flow) and, through `asking_session`, the session cookie (a
re-authentication is for the session that asked). The callback is the one state-changing GET of
the site: a top-level navigation back from classbeat, which needs the browser's own binding
cookie and the `state` of its own row. Every refusal of the callback answers the same `303` to
the sign-in page's error, with no reason in the address; no part of its query is logged or
echoed.
"""

from __future__ import annotations

import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, BeforeValidator

from player_backend.classbeat_client import ClassbeatClient
from player_backend.classbeat_flow_policy import (
    ERROR_PATH,
    callback_values,
    is_navigation,
    return_path,
)
from player_backend.classbeat_http import ClassbeatUnreachable
from player_backend.classbeat_policy import Identity, nonce_hash
from player_backend.classbeat_token_check import TokenRefused
from player_backend.db import classbeat, site_sessions
from player_backend.db.classbeat import Flow
from player_backend.db.executor import Pool
from player_backend.http_errors import ApiError
from player_backend.login_policy import bounded_return, is_return_entry
from player_backend.site.cookies import (
    classbeat_cookie_token,
    clear_classbeat_cookie,
    put_classbeat_cookie,
    put_session_cookie,
)
from player_backend.site.deps import AskingSession, Caller, TheCaller
from player_backend.site.state import site_state
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash

router = APIRouter()

BindingToken = Annotated[str | None, Depends(classbeat_cookie_token)]
# 32 random bytes, base64url: `state` and `nonce` (section 2, step 1).
_RANDOM_BYTES = 32
# A start over its limit: the window is 10 minutes; the client may try again within it.
_LIMITED_RETRY = "60"


class StartRequest(BaseModel):
    purpose: Literal["sign_in", "reauth"] = "sign_in"
    # As the email link's: any string, checked by `is_return_entry`, held cut to its bound.
    return_to: Annotated[str | None, BeforeValidator(bounded_return)] = None


def _client(request: Request) -> ClassbeatClient | None:
    return site_state(request).classbeat


@router.post("/sign-in/classbeat/start")
def start(
    body: StartRequest,
    request: Request,
    who: TheCaller,
    asking: AskingSession,
    held: BindingToken,
) -> JSONResponse:
    """Open a flow: its row, the binding cookie, and the authorize address to navigate to."""
    client = _client(request)
    if client is None:
        raise ApiError(404, "not_found")
    if body.return_to is not None and not is_return_entry(body.return_to):
        raise ApiError(422, "invalid_return")
    reauth = body.purpose == "reauth"
    if reauth and asking is None:
        raise ApiError(401, "not_signed_in")
    binding = new_token("cbs")
    state = secrets.token_urlsafe(_RANDOM_BYTES)
    nonce = secrets.token_urlsafe(_RANDOM_BYTES)
    outcome = classbeat.start(
        site_state(request).pool,
        binding_hash=token_hash(binding),
        state_hash=token_hash(state),
        nonce_hash=nonce_hash(nonce),
        purpose=body.purpose,
        return_to=body.return_to,
        asking_session_hash=asking if reauth else None,
        held_binding_hash=None if held is None else token_hash(held),
        address_hash=who.address_hash,
    )
    if outcome == "limited":
        raise ApiError(429, "too_many_requests", {"Retry-After": _LIMITED_RETRY})
    if outcome == "not_signed_in":
        raise ApiError(401, "not_signed_in")
    address = client.authorize(state=state, nonce=nonce, verifier=binding, purpose=body.purpose)
    response = JSONResponse({"authorize": address})
    put_classbeat_cookie(response, binding)
    return response


def _refused(*, clear: bool) -> Response:
    response = RedirectResponse(ERROR_PATH, status_code=303)
    if clear:
        clear_classbeat_cookie(response)
    return response


@router.get("/sign-in/classbeat/callback")
def callback(
    request: Request, who: TheCaller, asking: AskingSession, binding: BindingToken
) -> Response:
    """Complete a flow: once, within 10 minutes, in the browser that started it."""
    client = _client(request)
    if client is None or not is_navigation(
        request.headers.get("sec-fetch-mode"), request.headers.get("sec-fetch-dest")
    ):
        return _refused(clear=False)
    values = callback_values(request.query_params.multi_items(), client.settings.issuer)
    if values is None or binding is None:
        return _refused(clear=False)
    code, state = values
    pool = site_state(request).pool
    flow = classbeat.take(
        pool,
        binding_hash=token_hash(binding),
        state_hash=token_hash(state),
        address_hash=who.address_hash,
    )
    # From here the binding is spent (or never was): the cookie is cleared on every answer.
    if flow is None:
        return _refused(clear=True)
    if flow.purpose == "reauth" and asking != flow.asking_session_hash:
        return _refused(clear=True)
    try:
        identity = client.identity(code=code, verifier=binding, nonce_hash=flow.nonce_hash)
    except (TokenRefused, ClassbeatUnreachable):
        return _refused(clear=True)
    session_token = new_token("ses")
    if not _signed_in(pool, flow, identity, token_hash(session_token), who):
        return _refused(clear=True)
    if asking is not None:
        # ADR 0002, section 5: the session the browser held is ended, as signing out ends it.
        site_sessions.end_asking_session(pool, asking, who.info)
    response = RedirectResponse(return_path(flow.return_to), status_code=303)
    clear_classbeat_cookie(response)
    put_session_cookie(response, session_token)
    return response


def _signed_in(
    pool: Pool,
    flow: Flow,
    identity: Identity,
    session_hash: bytes,
    who: Caller,
) -> bool:
    if flow.purpose == "reauth" and flow.asking_session_hash is not None:
        return (
            classbeat.reauthenticate(
                pool,
                asking_session_hash=flow.asking_session_hash,
                identity=identity,
                started_at=flow.started_at,
                session_hash=session_hash,
                client=who.info,
            )
            == "reauthenticated"
        )
    if flow.purpose == "reauth":
        return False
    outcome = classbeat.complete(
        pool,
        identity=identity,
        session_hash=session_hash,
        address_hash=who.address_hash,
        client=who.info,
    )
    return outcome == "signed_in"
