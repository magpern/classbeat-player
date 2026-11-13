"""The account's export and its deletion on the site (ADR 0002, sections 10, 11 and 12).

Both are POSTs, so the origin check applies, and both need a recent sign-in.

- `POST /api/site/account/export`: one JSON document of the account's own data, made for this
  request and sent as a download. Nothing is stored on the server and there is no link to it.
  Counted 3 a day per account; over that, 429 with the count kept.
- `POST /api/site/account/delete`, body `{"confirm": "<the account's email>"}`: deletes the
  account and everything it owns in the request's transaction, signs this browser out, and
  every other token of the account is refused from the next request on.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from player_backend.account_policy import CONFIRM_MAX, EXPORT_WINDOW
from player_backend.db import account
from player_backend.http_errors import ApiError, error_response
from player_backend.login_policy import retry_after
from player_backend.site.bodies import RawBody, parsed
from player_backend.site.cookies import clear_session_cookie
from player_backend.site.deps import NotSignedIn, RecentSignIn, TheCaller

router = APIRouter()

EXPORT_FILE = "class-player-export.json"


class Deletion(BaseModel):
    confirm: str = Field(max_length=10 * CONFIRM_MAX)


@router.post("/account/export")
def export_account(context: RecentSignIn, who: TheCaller) -> Response:
    if account.over_export_limit(context):
        # Returned, not raised: raising would roll the count back.
        after = retry_after(time.time(), EXPORT_WINDOW)
        return error_response(429, "too_many_requests", {"Retry-After": str(after)})
    document = account.export(context, who.info)
    if document is None:
        raise NotSignedIn
    return JSONResponse(
        document, headers={"Content-Disposition": f'attachment; filename="{EXPORT_FILE}"'}
    )


@router.post("/account/delete")
def delete_account(raw: RawBody, context: RecentSignIn) -> Response:
    body = parsed(Deletion, raw)
    outcome = account.delete(context, body.confirm)
    if outcome == "not_confirmed":
        raise ApiError(422, "confirmation_mismatch")
    if outcome == "gone":
        raise NotSignedIn
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response
