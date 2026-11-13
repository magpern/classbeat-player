"""`POST /api/live/controller` and `POST /api/live/control`: becoming a controller (ADR 0002,
sections 5, 8 and 10; ADR 0005, sections 3, 4 and 10).

- *By sign-in* (`/controller`): the one live route that takes the session cookie, with the
  site's `Origin` and `Sec-Fetch-Site` checks. The body's `session` (the join code) only names
  the session: the site session's account must be the live session's account. Every refusal but
  a malformed body (422) is one answer, 403 `cannot_control`: no sign-in, another origin,
  another account, an unknown session, both places held, or either limit below.
- Its limits (live_signin_policy.py): a call without a valid site session is refused before any
  join code is looked up and counts for the caller's address; past 60 a minute, a call from that
  address with no session cookie is refused without a lookup until the minute ends (one with a
  cookie is still looked up, so a valid session is never refused). A join code that names no
  session of the account counts for the account; past 60 a minute, every call of the account is
  refused until the minute ends. Neither is the per-address limit below.
- *By control code* (`/control`): no credential. An unknown session and a wrong code are both
  403 `invalid_code`; a right code while both places are held is 409 `controllers_full`, and is
  neither used up nor a wrong try. A join code that names no session counts for the caller's
  address; past 60 a minute every request from that address gets 429 with `Retry-After` until
  its minute ends.
- A body is checked with the contract's schema before anything is looked up; it must be sent
  as JSON. The answer, the contract's `controller-answer`, holds the controller token, given out
  once, here (`Cache-Control: no-store`, like every API answer).
- A sign-in grant whose answer is never sent is taken back: anything that fails after the
  grant, the audit write or the site session's commit, frees the place again (`_Grant`).
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine, Generator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from player_backend.http_errors import ApiError
from player_backend.live.events import Granted
from player_backend.live.schemas import valid
from player_backend.live.state import live_service
from player_backend.live_wire_policy import Message, decode
from player_backend.param_policy import is_json
from player_backend.site.bodies import Body, RawBody
from player_backend.site.cookies import session_cookie_token
from player_backend.site.deps import SiteSession, TheCaller, caller, same_origin
from player_backend.token_policy import token_hash


class _OneRefusal(APIRoute):
    """The sign-in route's credential refusals (401 and 403: no or an ended sign-in, another
    origin, and the route's own) all become 403 `cannot_control`, so that the answer tells
    nothing about the session or the sign-in. A 401 (no valid site session) counts for the
    caller's address (`_signed_out_gate` refuses past the limit)."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def answered(request: Request) -> Response:
            try:
                return await handler(request)
            except ApiError as error:
                if error.status == 401:
                    live_service(request).signed_out(caller(request).address_hash)
                if error.status in (401, 403):
                    raise ApiError(403, "cannot_control") from None
                raise

        return answered


router = APIRouter()
sign_in_router = APIRouter(route_class=_OneRefusal)


def _body(raw: Body, schema: str) -> Message:
    """The body as the contract's `schema` holds it, or 422 `invalid_request`."""
    try:
        message = decode(raw.raw.decode("utf-8")) if is_json(raw.content_type) else None
    except UnicodeDecodeError:
        message = None
    if message is None or not valid(schema, message):
        raise ApiError(422, "invalid_request")
    return message


def _not_limited(request: Request, address_hash: bytes) -> None:
    wait = live_service(request).refused_for(address_hash)
    if wait is not None:
        raise ApiError(429, "too_many_requests", {"Retry-After": str(wait)})


def _signed_out_gate(
    request: Request,
    cookie: Annotated[str | None, Depends(session_cookie_token)],
    who: TheCaller,
) -> None:
    """Past the address's limit of calls without a site session, a call with no session cookie
    is refused before its sign-in or its join code is looked up. One with a cookie is still
    looked up, so a valid session is never refused here."""
    if cookie is None and live_service(request).signed_out_refused(who.address_hash):
        raise ApiError(403, "cannot_control")


def _token(token: str) -> JSONResponse:
    return JSONResponse({"controllerToken": token})


class _Grant:
    """The controller a sign-in request was granted, while its answer is not yet sent."""

    def __init__(self) -> None:
        self.granted: Granted | None = None


def _taken_back_on_failure(request: Request) -> Generator[_Grant]:
    """Free the place of a grant whose answer is never sent. Declared before `site_session`,
    this exits after it, so a failed commit of the site session's transaction (which runs as
    `site_session` exits, after the route has returned) reaches here as well as a failed
    audit write. Declared after the body, as it counts as a dependency that holds a
    transaction (guards/test_guard_body_order.py).

    `scope="function"` where it is declared is a choice, not a requirement: request-scoped, it
    would see the same failed commit, as the function-scoped exits run inside the request's.
    It is kept function-scoped so the release runs before the answer is sent. A place still
    held when sending the answer fails, after the commit, is not freed here; the host's `drop`
    frees it (tests/test_live_controller_routes.py)."""
    grant = _Grant()
    try:
        yield grant
    except BaseException:
        if grant.granted is not None:
            live_service(request).release(grant.granted)
        raise


@sign_in_router.post("/controller", dependencies=[Depends(same_origin), Depends(_signed_out_gate)])
def by_sign_in(
    raw: RawBody,
    grant: Annotated[_Grant, Depends(_taken_back_on_failure, scope="function")],
    context: SiteSession,
    cookie: Annotated[str | None, Depends(session_cookie_token)],
    who: TheCaller,
    request: Request,
) -> JSONResponse:
    body = _body(raw, "controller-request.schema.json")
    if cookie is None:  # not reached: the session dependency refused it already
        raise ApiError(403, "cannot_control")
    # The hash of the site session that asked: the re-check drops the controller with it.
    granted = live_service(request).by_sign_in(
        context, body["session"], token_hash(cookie), who.info
    )
    if granted is None:
        raise ApiError(403, "cannot_control")
    grant.granted = granted
    return _token(granted.token)


@router.post("/control")
def by_code(raw: RawBody, who: TheCaller, request: Request) -> JSONResponse:
    body = _body(raw, "control-request.schema.json")
    _not_limited(request, who.address_hash)
    exchanged = live_service(request).by_code(
        body["session"], body["code"], who.address_hash, who.info
    )
    if exchanged.granted is not None:
        return _token(exchanged.granted.token)
    if exchanged.refusal == "full":
        raise ApiError(409, "controllers_full")
    raise ApiError(403, "invalid_code")


router.include_router(sign_in_router)
