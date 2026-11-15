"""The site's cookies (ADR 0002, sections 4 and 5; ADR 0010, section 2). The only module that
reads a cookie.

All are `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, with no `Domain`. Reading
is done by the dependencies below and by nothing else: a guard test lists the routes that
use them (tests/guards/test_guard_cookie_routes.py). A value that is not a token of the
cookie's own type is refused here, by its prefix, before any lookup.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Final

from fastapi import Request, Response

from player_backend.token_policy import is_token

SESSION_COOKIE: Final = "__Host-cbp_session"
LOGIN_COOKIE: Final = "__Host-cbp_login"
# The binding of one classbeat sign-in to the browser that started it (ADR 0010, section 2).
BINDING_COOKIE: Final = "__Host-cbp_cbsign"
# Section 5: `Max-Age` equals the session's absolute lifetime. Section 4: one hour.
SESSION_MAX_AGE: Final = int(timedelta(days=60).total_seconds())
LOGIN_MAX_AGE: Final = int(timedelta(hours=1).total_seconds())
BINDING_MAX_AGE: Final = 600


def session_cookie_token(request: Request) -> str | None:
    """The session token of the request's cookie, or None when there is no well-formed one."""
    value = request.cookies.get(SESSION_COOKIE)
    return value if is_token("ses", value) else None


def login_cookie_token(request: Request) -> str | None:
    """The browser token of the request's cookie, or None when there is no well-formed one."""
    value = request.cookies.get(LOGIN_COOKIE)
    return value if is_token("lgn", value) else None


def classbeat_cookie_token(request: Request) -> str | None:
    """The binding token of the request's cookie, or None when there is no well-formed one."""
    value = request.cookies.get(BINDING_COOKIE)
    return value if is_token("cbs", value) else None


def _put(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name, value, max_age=max_age, path="/", secure=True, httponly=True, samesite="lax"
    )


def put_session_cookie(response: Response, token: str) -> None:
    _put(response, SESSION_COOKIE, token, SESSION_MAX_AGE)


def put_login_cookie(response: Response, token: str) -> None:
    _put(response, LOGIN_COOKIE, token, LOGIN_MAX_AGE)


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="lax")


def put_classbeat_cookie(response: Response, token: str) -> None:
    _put(response, BINDING_COOKIE, token, BINDING_MAX_AGE)


def clear_classbeat_cookie(response: Response) -> None:
    response.delete_cookie(BINDING_COOKIE, path="/", secure=True, httponly=True, samesite="lax")
