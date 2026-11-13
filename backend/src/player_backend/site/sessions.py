"""The account's site sessions (ADR 0002, section 5): list them, end one, sign out, end all.

Ending a session deletes its row, so it takes effect on the next request.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from player_backend.db import site_sessions
from player_backend.http_errors import ApiError
from player_backend.param_policy import uuid_of
from player_backend.site.cookies import clear_session_cookie
from player_backend.site.deps import NotSignedIn, RecentSignIn, SiteSession, TheCaller

router = APIRouter()


def _signed_out() -> Response:
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@router.get("/sessions")
def list_sessions(context: SiteSession) -> JSONResponse:
    return JSONResponse(
        {
            "sessions": [
                {
                    "id": str(session.id),
                    "browser": session.family,
                    "created_at": session.created_at.isoformat(),
                    "last_used_at": session.last_used_at.isoformat(),
                    "current": session.id == context.credential_id,
                }
                for session in site_sessions.list_sessions(context)
            ]
        }
    )


@router.delete("/sessions/{session_id}")
def end_session(session_id: str, context: SiteSession, who: TheCaller) -> Response:
    # Raw text, parsed here: a value the framework refused would roll back "last used".
    parsed = uuid_of(session_id)
    if parsed is None:
        raise ApiError(422, "invalid_request")
    if not site_sessions.end_session(context, parsed, who.info):
        raise ApiError(404, "not_found")
    return _signed_out() if parsed == context.credential_id else Response(status_code=204)


class _SignedOutAlready(APIRoute):
    """Signing out with no live session is done already: 204, and the stale cookie is cleared.

    The route keeps the one session dependency, so the cookie is read and checked as everywhere
    else, and the origin check has run before it. Only its "not signed in" is answered here.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def signed_out_already(request: Request) -> Response:
            try:
                return await handler(request)
            except NotSignedIn:
                return _signed_out()

        return signed_out_already


_sign_out_router = APIRouter(route_class=_SignedOutAlready)


@_sign_out_router.post("/sign-out")
def sign_out(context: SiteSession, who: TheCaller) -> Response:
    site_sessions.end_session(context, context.credential_id, who.info)
    return _signed_out()


router.include_router(_sign_out_router)


@router.post("/sessions/end-all")
def end_all_sessions(context: RecentSignIn, who: TheCaller) -> Response:
    """Sign out everywhere: a sensitive action, so it needs a recent sign-in."""
    site_sessions.end_all_sessions(context, who.info)
    return _signed_out()
