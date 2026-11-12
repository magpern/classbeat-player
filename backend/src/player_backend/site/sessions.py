"""The account's site sessions (ADR 0002, section 5): list them, end one, sign out, end all.

Ending a session deletes its row, so it takes effect on the next request.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from player_backend.db import site_sessions
from player_backend.http_errors import ApiError
from player_backend.site.cookies import clear_session_cookie
from player_backend.site.deps import RecentSignIn, SiteSession, TheCaller

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
def end_session(session_id: UUID, context: SiteSession, who: TheCaller) -> Response:
    if not site_sessions.end_session(context, session_id, who.info):
        raise ApiError(404, "not_found")
    return _signed_out() if session_id == context.credential_id else Response(status_code=204)


@router.post("/sign-out")
def sign_out(context: SiteSession, who: TheCaller) -> Response:
    site_sessions.end_session(context, context.credential_id, who.info)
    return _signed_out()


@router.post("/sessions/end-all")
def end_all_sessions(context: RecentSignIn, who: TheCaller) -> Response:
    """Sign out everywhere: a sensitive action, so it needs a recent sign-in."""
    site_sessions.end_all_sessions(context, who.info)
    return _signed_out()
