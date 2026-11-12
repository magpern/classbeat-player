"""Pairing as the signed-in user sees it (ADR 0002, section 6, step 3): look up, then decide.

Both are POSTs with the user code in the body. A wrong code is counted inside the database, in
the request's transaction, and an approval above the cap of devices writes its event there, so
a refusal here is returned, not raised: raising would roll the count and the event back.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from player_backend.code_policy import INPUT_MAX, code_hash, normalise_code
from player_backend.db import pairing
from player_backend.http_errors import ApiError, error_response
from player_backend.pairing_policy import LABEL_MAX, clean_label
from player_backend.site.deps import SiteSession, TheCaller

router = APIRouter()


class CodeLookup(BaseModel):
    code: str = Field(max_length=INPUT_MAX)


class CodeDecision(BaseModel):
    code: str = Field(max_length=INPUT_MAX)
    approve: bool
    name: str | None = Field(default=None, max_length=10 * LABEL_MAX)


def _hash_of(typed: str) -> bytes:
    code = normalise_code(typed)
    if code is None:
        # Not a short code at all: nothing is compared, so nothing is counted.
        raise ApiError(422, "invalid_code")
    return code_hash(code)


def _not_found() -> JSONResponse:
    # One answer for a wrong code, an ended or decided pairing, and a closed form.
    return error_response(404, "pairing_not_found")


@router.post("/pairing/find")
def find(body: CodeLookup, context: SiteSession) -> JSONResponse:
    """What asks to be paired, shown before anything is decided."""
    found = pairing.find(context, _hash_of(body.code))
    if found is None:
        return _not_found()
    platform, version = found
    return JSONResponse({"platform": platform, "version": version})


@router.post("/pairing/decide")
def decide(body: CodeDecision, context: SiteSession, who: TheCaller) -> JSONResponse:
    user_code_hash = _hash_of(body.code)
    name = clean_label(body.name) if body.approve else None
    if body.approve and name is None:
        raise ApiError(422, "invalid_name")
    # The cap of devices is the function's alone to check: it counts the pairings that are
    # approved and not collected yet, which only it can see, and writes `pairing.refused`.
    decision = pairing.decide(
        context, user_code_hash=user_code_hash, approve=body.approve, name=name, client=who.info
    )
    if decision == "device_limit":
        # Told apart for the user, and only for a code that names a pending pairing.
        return error_response(409, "too_many_devices")
    if decision != "decided":
        return _not_found()
    return JSONResponse({"status": "approved" if body.approve else "denied"})
