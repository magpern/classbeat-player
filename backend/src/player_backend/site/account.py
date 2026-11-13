"""The account's export and its deletion on the site (ADR 0002, sections 10, 11 and 12).

Both are POSTs, so the origin check applies, and both need a recent sign-in.

- `POST /api/site/account/export`: one JSON document of the account's own data, streamed as a
  download. The checks, the count and the "export made" event commit with the request's
  transaction; the classes are then read a page of 16 at a time, each page entering the
  session again. When the session ends or the account goes meanwhile, the stream stops and
  the download is not valid JSON. Nothing is stored on the server and there is no link to it.
  Counted 3 a day per account; over that, 429 with the count kept.
- `POST /api/site/account/delete`, body `{"confirm": "<the account's email>"}`: deletes the
  account and everything it owns in the request's transaction, signs this browser out, and
  every other token of the account is refused from the next request on.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from player_backend.account_policy import CONFIRM_MAX, EXPORT_WINDOW, ExportStopped, export_chunks
from player_backend.db import account
from player_backend.db.executor import Pool
from player_backend.http_errors import ApiError, error_response
from player_backend.login_policy import retry_after
from player_backend.site.bodies import RawBody, parsed
from player_backend.site.cookies import clear_session_cookie, session_cookie_token
from player_backend.site.deps import NotSignedIn, RecentSignIn, TheCaller
from player_backend.site.state import site_state
from player_backend.token_policy import token_hash

router = APIRouter()
log = logging.getLogger(__name__)

EXPORT_FILE = "class-player-export.json"


class Deletion(BaseModel):
    confirm: str = Field(max_length=10 * CONFIRM_MAX)


def _streamed(
    head: dict[str, object], pool: Pool, session_hash: bytes, account_id: UUID
) -> Iterator[bytes]:
    """The export's bytes. A stop leaves the document unclosed, never an error page in it."""
    try:
        yield from export_chunks(head, account.class_pages(pool, session_hash, account_id))
    except ExportStopped:
        return
    except Exception as error:
        # Only the kind of failure: never the account, the token or a document.
        log.warning("account export stopped: %s", type(error).__name__)


@router.post("/account/export")
def export_account(
    request: Request,
    context: RecentSignIn,
    who: TheCaller,
    token: Annotated[str | None, Depends(session_cookie_token)],
) -> Response:
    if account.over_export_limit(context):
        # Returned, not raised: raising would roll the count back.
        after = retry_after(time.time(), EXPORT_WINDOW)
        return error_response(429, "too_many_requests", {"Retry-After": str(after)})
    head = account.export_head(context, who.info)
    if head is None or token is None:
        raise NotSignedIn
    # Written after the request's transaction has committed; each page enters the session anew.
    body = _streamed(head, site_state(request).pool, token_hash(token), context.account_id)
    return StreamingResponse(
        body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{EXPORT_FILE}"'},
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
