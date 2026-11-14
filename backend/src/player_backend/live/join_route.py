"""`POST /api/live/join`: joining a live session as a rider (ADR 0007, sections 2 and 3; ADR
0002, sections 8 and 10).

- No credential: no cookie, no bearer token. The body, checked with the contract's schema before
  anything is looked up, is exactly `session` (the join code, which only names the session) and
  `nickname`. A nickname with nothing left once its control characters are removed is 422
  `invalid_request`, as a malformed body is, before any lookup: that answer says nothing about
  the session.
- Every refusal of a well-formed join is one answer, 403 `cannot_join`, with the same body: an
  unknown code, a session's earlier code, a locked session, a full one, or one past its 120
  joins a minute.
- A join code that names no session counts for the caller's address, with the control
  exchanges'; past 60 a minute every join from that address gets 429 with `Retry-After` until
  its minute ends.
- The answer, the contract's `join-answer`, holds the rider token, given out once, here
  (`Cache-Control: no-store`, like every API answer). The nickname, the code and the token are
  never logged.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from player_backend.http_errors import ApiError
from player_backend.live.control_routes import address_not_limited, request_body
from player_backend.live.state import live_service
from player_backend.live_rider_policy import clean_nickname
from player_backend.site.bodies import RawBody
from player_backend.site.deps import TheCaller

router = APIRouter()


@router.post("/join")
def join(raw: RawBody, who: TheCaller, request: Request) -> JSONResponse:
    body = request_body(raw, "join-request.schema.json")
    nickname = clean_nickname(body["nickname"])
    if nickname is None:
        raise ApiError(422, "invalid_request")
    address_not_limited(request, who.address_hash)
    token = live_service(request).join(body["session"], nickname, who.address_hash)
    if token is None:
        raise ApiError(403, "cannot_join")
    return JSONResponse({"riderToken": token})
