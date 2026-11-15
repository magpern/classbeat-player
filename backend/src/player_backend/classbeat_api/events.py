"""`POST /api/classbeat/events`: the events classbeat sends (ADR 0010, section 8).

classbeat's server posts one back-channel logout token, `logout_token`, as
`application/x-www-form-urlencoded`. The route reads no cookie and takes no other credential.
In order:

1. a request with `Sec-Fetch-Site`, of any value, is a browser's: `403 cross_site_request`,
   before the body is read (a dependency of the router);
2. `404 not_found` when sign-in with classbeat is not configured;
3. a body not sent as a form: `415 unsupported_media_type`;
4. the address's count, 600 a minute: over it, `429` (classbeat retries);
5. the token's check (classbeat_token_check.py): any refusal, or a body that is not exactly one
   `logout_token`, is `400 bad_event`, with no reason given;
6. the event, once per `jti`: a repeat, a subject with no account and an accepted event each
   answer `200` with an empty body, as back-channel logout specifies.

Nothing of the token, its subject or its `jti` is logged or echoed.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from player_backend.classbeat_event_policy import (
    LIMIT_WINDOW,
    from_browser,
    is_form,
    limit_key,
    logout_token_of,
)
from player_backend.classbeat_token_check import TokenRefused
from player_backend.db import classbeat_events
from player_backend.http_errors import ApiError
from player_backend.site.bodies import RawBody
from player_backend.site.deps import TheCaller
from player_backend.site.state import site_state

_RETRY_AFTER = str(int(LIMIT_WINDOW.total_seconds()))


def server_only(request: Request) -> None:
    """Refuse a browser's request: every browser sends `Sec-Fetch-Site`; classbeat's server
    does not. Runs before the body is read and before anything is counted."""
    if from_browser(request.headers.get("sec-fetch-site")):
        raise ApiError(403, "cross_site_request")


router = APIRouter(prefix="/api/classbeat", dependencies=[Depends(server_only)])


@router.post("/events")
def events(raw: RawBody, request: Request, who: TheCaller) -> Response:
    state = site_state(request)
    client = state.classbeat
    if client is None:
        raise ApiError(404, "not_found")
    if not is_form(raw.content_type):
        raise ApiError(415, "unsupported_media_type")
    if classbeat_events.over_limit(state.pool, limit_key(who.address_hash)):
        raise ApiError(429, "too_many_requests", {"Retry-After": _RETRY_AFTER})
    token = logout_token_of(raw.raw)
    if token is None:
        raise ApiError(400, "bad_event")
    try:
        event = client.event(token)
    except TokenRefused:
        raise ApiError(400, "bad_event") from None
    classbeat_events.apply(state.pool, event)
    return Response(status_code=200)
