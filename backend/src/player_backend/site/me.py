"""The signed-in account itself on the site (ADR 0002, section 4): `GET /api/site/me`.

A site session is required; the account is read in its own context. The answer is the account's
own email, as stored, and nothing else: it is built and checked through the contract's generated
model (schema/site-api/v1/me.schema.json), which refuses any other field. Like every answer of
the site's API it is `Cache-Control: no-store` (request_policy.py).
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from player_backend.db import account
from player_backend.site.answers import me_answer
from player_backend.site.deps import NotSignedIn, SiteSession

router = APIRouter()


@router.get("/me")
def me(context: SiteSession) -> JSONResponse:
    email = account.email(context)
    if email is None:
        # The account went while the session was still being checked: nobody is signed in.
        raise NotSignedIn
    answer = me_answer()(email=email)
    return JSONResponse(answer.model_dump(mode="json"))
