"""`POST /api/live/sessions` (ADR 0002, section 8; ADR 0005, sections 2 and 4).

The app starts a live session with its device token, the one dependency of that credential
(player_api/deps.py), and nothing else: no cookie, no body. The answer is the contract's
`session-answer`: the session id, the join code and the host token, given out once, here.
The device's earlier session ends first; with 3 sessions on other devices of the account the
answer is 409 `sessions_full`, and nothing is started or ended.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from player_backend.bearer_policy import bearer_device_token
from player_backend.http_errors import ApiError
from player_backend.live.state import live_service
from player_backend.player_api.deps import DeviceToken
from player_backend.site.deps import TheCaller
from player_backend.token_policy import token_hash

router = APIRouter(prefix="/api/live")


@router.post("/sessions")
def start_session(context: DeviceToken, who: TheCaller, request: Request) -> JSONResponse:
    # The same header the dependency has just entered the account with: its hash is what the
    # re-check asks `auth_device_active` about and what the end's event is written after.
    token = bearer_device_token(request.headers.get("authorization"))
    if token is None:  # not reached: the dependency refused it already
        raise ApiError(401, "invalid_token", {"WWW-Authenticate": "Bearer"})
    started = live_service(request).start(context, token_hash(token), who.info)
    if started is None:
        raise ApiError(409, "sessions_full")
    return JSONResponse(
        {
            "sessionId": str(started.session_id),
            "joinCode": started.join_code,
            "hostToken": started.host_token,
        }
    )
