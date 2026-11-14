"""Dependencies of the site's routes (ADR 0002, sections 4, 5 and 9, "In FastAPI").

`site_session` is the one dependency of the session credential: it opens the request's
transaction, calls `auth_enter_session` as its first statement and yields the `AccountContext`.
The transaction is committed when the route's function has returned, before the response is
sent. A route that refuses the request (an `ApiError`: a 403 or a 404) has its own writes rolled
back and the session's "last used" kept: the session was used. Any other error rolls back all.

`asking_session` is the session cookie's one other reader, for the two routes that complete a
sign-in alone: it only hashes the token, so that the sign-in can end the session it replaces
(section 5).
"""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from player_backend.client_policy import ClientInfo, address_hash, client_address, client_info
from player_backend.db import site_sessions
from player_backend.db.context import AccountContext, undone_on_error
from player_backend.http_errors import ApiError
from player_backend.request_policy import cross_site_refusal, is_recent_sign_in
from player_backend.site.cookies import session_cookie_token
from player_backend.site.state import site_state
from player_backend.token_policy import token_hash


def same_origin(request: Request) -> None:
    """Refuse a cross-site state change. Runs before any credential is looked at."""
    refusal = cross_site_refusal(
        request.method,
        request.headers.get("origin"),
        request.headers.get("sec-fetch-site"),
        site_state(request).settings.site_origin,
    )
    if refusal is not None:
        raise ApiError(403, "cross_site_request")


@dataclass(frozen=True)
class Caller:
    """The client as the backend saw it: its key in the counters, and what an event records."""

    address_hash: bytes
    info: ClientInfo


def caller(request: Request) -> Caller:
    peer = request.client.host if request.client is not None else None
    forwarded = ",".join(request.headers.getlist("x-forwarded-for")) or None
    address = client_address(peer, forwarded, site_state(request).settings.trusted_proxies)
    return Caller(
        address_hash=address_hash(address),
        info=client_info(address, request.headers.get("user-agent")),
    )


class NotSignedIn(ApiError):
    """The request has no live session: no cookie, a malformed one, or one that has ended."""

    def __init__(self) -> None:
        super().__init__(401, "not_signed_in")


def site_session(
    request: Request, token: Annotated[str | None, Depends(session_cookie_token)]
) -> Generator[AccountContext]:
    if token is None:
        raise NotSignedIn
    refusal: ApiError | None = None
    with site_sessions.entered(site_state(request).pool, token_hash(token)) as context:
        if context is None:
            raise NotSignedIn
        try:
            # What the route wrote is undone when it refuses, and nothing else is.
            with undone_on_error(context):
                yield context
        except ApiError as error:
            refusal = error
    # Raised again once the transaction, with the session's "last used", has been committed.
    if refusal is not None:
        raise refusal


def asking_session(
    token: Annotated[str | None, Depends(session_cookie_token)],
) -> bytes | None:
    """For the routes that sign in: the hash of the session the browser holds, or None.

    It gives no access. Its only use is to end that session once a new one has been issued
    (`site_sessions.end_asking_session`), so the browser leaves no second row behind.
    """
    return None if token is None else token_hash(token)


def recent_sign_in(
    context: Annotated[AccountContext, Depends(site_session, scope="function")],
) -> AccountContext:
    """For sensitive actions: the user proved who they are within the last 10 minutes."""
    signed_in_at = context.signed_in_at
    if signed_in_at is None or not is_recent_sign_in(signed_in_at, context.entered_at):
        raise ApiError(403, "recent_sign_in_required")
    return context


SiteSession = Annotated[AccountContext, Depends(site_session, scope="function")]
RecentSignIn = Annotated[AccountContext, Depends(recent_sign_in)]
TheCaller = Annotated[Caller, Depends(caller)]
AskingSession = Annotated[bytes | None, Depends(asking_session)]
