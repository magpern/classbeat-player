"""Linking a source as the signed-in user sees it (ADR 0002, section 7, steps 2 to 4), and the
account's links: list them, revoke one.

- `POST /source-links/check`: which product asks and what it may do. An unknown source or
  redirect address is refused, and the page then redirects nowhere.
- `POST /source-links/approve`: the page's script sends the approval and gets the address to go
  back to, with the `cbp_lc_` code and the `state`. Not a form submission: `form-action 'self'`
  stays as it is.
- Revoking deletes the link: its token is unknown from the next request on. The classes stay.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from player_backend.db import sources
from player_backend.http_errors import ApiError
from player_backend.mail_delivery import deliver
from player_backend.site.deps import SiteSession, TheCaller
from player_backend.site.state import site_state
from player_backend.source_policy import (
    MAX_LINKS,
    REDIRECT_MAX,
    SCOPE,
    KnownSource,
    back_to_source,
    find_source,
    linked_mail,
    valid_challenge,
    valid_state,
)
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash

router = APIRouter()


class LinkRequest(BaseModel):
    source: str = Field(max_length=40)
    redirect_uri: str = Field(max_length=REDIRECT_MAX)


class LinkApproval(LinkRequest):
    state: str = Field(max_length=500)
    code_challenge: str = Field(max_length=100)
    code_challenge_method: str | None = Field(default=None, max_length=10)


def _known(request: Request, body: LinkRequest) -> KnownSource:
    found = find_source(site_state(request).settings.sources, body.source, body.redirect_uri)
    if found is None:
        # One answer for an unknown source and an address it may not use: never a redirect.
        raise ApiError(400, "unknown_source")
    return found


def _display_name(request: Request, source_id: str) -> str:
    for source in site_state(request).settings.sources:
        if source.id == source_id:
            return source.name
    return source_id


@router.post("/source-links/check")
def check(body: LinkRequest, request: Request, context: SiteSession) -> JSONResponse:
    source = _known(request, body)
    return JSONResponse({"source": source.id, "name": source.name, "scope": list(SCOPE)})


@router.post("/source-links/approve")
def approve(
    body: LinkApproval, request: Request, context: SiteSession, who: TheCaller
) -> JSONResponse:
    source = _known(request, body)
    if not valid_challenge(body.code_challenge, body.code_challenge_method):
        raise ApiError(422, "invalid_code_challenge")
    if not valid_state(body.state):
        raise ApiError(422, "invalid_state")
    if len(sources.list_links(context)) >= MAX_LINKS:
        # Told apart for the user. The exchange refuses it too, inside the database.
        raise ApiError(409, "too_many_links")
    code = new_token("lc")
    sources.new_link_code(
        context,
        code_hash=token_hash(code),
        source_id=source.id,
        redirect_uri=body.redirect_uri,
        challenge=body.code_challenge,
    )
    response = JSONResponse({"redirect": back_to_source(body.redirect_uri, code, body.state)})
    email = sources.account_email(context)
    if email is not None:
        # Section 6: an approved source link sends the account a notice, after the response.
        mail = linked_mail(site_state(request).settings.site_origin, email, source.name)
        response.background = BackgroundTask(deliver, site_state(request).mailer, mail)
    return response


@router.get("/source-links")
def list_links(request: Request, context: SiteSession) -> JSONResponse:
    return JSONResponse(
        {
            "source_links": [
                {
                    "id": str(link.id),
                    "source": link.source_id,
                    "name": _display_name(request, link.source_id),
                    "linked_at": link.linked_at.isoformat(),
                    "last_used_at": (
                        None if link.last_used_at is None else link.last_used_at.isoformat()
                    ),
                }
                for link in sources.list_links(context)
            ]
        }
    )


@router.delete("/source-links/{link_id}")
def revoke_link(link_id: UUID, context: SiteSession, who: TheCaller) -> Response:
    if not sources.revoke(context, link_id, who.info):
        raise ApiError(404, "not_found")
    return Response(status_code=204)
