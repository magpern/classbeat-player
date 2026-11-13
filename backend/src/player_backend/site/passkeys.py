"""The account's passkeys on the site (ADR 0002, sections 4, 10 and 11): list, add, rename,
remove.

Adding (both its steps) and removing need a recent sign-in; listing and renaming need a
session. Starting a registration is counted per account (section 10). Adding uses up this
session's registration challenge whatever the check of the credential says, so its refusals
are returned, not raised: raising would roll the use back.
What the site is told of a passkey is its id, its name and its dates: never its credential
id or its key.
"""

from __future__ import annotations

import secrets
import time

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from player_backend.db import passkeys
from player_backend.db.passkeys import PasskeyInfo
from player_backend.http_errors import ApiError, error_response
from player_backend.login_policy import retry_after
from player_backend.mail_delivery import deliver
from player_backend.param_policy import uuid_of
from player_backend.passkey_policy import (
    BUSY_RETRY_SECONDS,
    CHALLENGE_BYTES,
    NAME_MAX,
    STARTS_WINDOW,
    NewPasskey,
    added_mail,
    challenge_hash,
    clean_name,
)
from player_backend.site.bodies import RawBody, parsed
from player_backend.site.deps import RecentSignIn, SiteSession, TheCaller
from player_backend.site.state import site_state
from player_backend.webauthn_check import registration_options, verified_registration
from player_backend.webauthn_data_policy import challenge_of

router = APIRouter()


class AttestationResponse(BaseModel):
    clientDataJSON: str = Field(max_length=4096)
    attestationObject: str = Field(max_length=10240)
    transports: list[str] | None = Field(default=None, max_length=10)


class Attestation(BaseModel):
    """What `navigator.credentials.create()` gave, in WebAuthn's JSON form."""

    id: str = Field(max_length=1400)
    rawId: str = Field(max_length=1400)
    type: str = Field(max_length=40)
    response: AttestationResponse
    authenticatorAttachment: str | None = Field(default=None, max_length=40)


class Registration(BaseModel):
    name: str = Field(max_length=10 * NAME_MAX)
    credential: Attestation


class Renaming(BaseModel):
    name: str = Field(max_length=10 * NAME_MAX)


def _shown(passkey: PasskeyInfo) -> dict[str, object]:
    return {
        "id": str(passkey.id),
        "name": passkey.name,
        "created_at": passkey.created_at.isoformat(),
        "last_used_at": None if passkey.last_used_at is None else passkey.last_used_at.isoformat(),
    }


def _name_of(raw: str) -> str:
    name = clean_name(raw)
    if name is None:
        raise ApiError(422, "invalid_name")
    return name


@router.get("/passkeys")
def list_passkeys(context: SiteSession) -> JSONResponse:
    return JSONResponse({"passkeys": [_shown(p) for p in passkeys.list_passkeys(context)]})


@router.post("/passkeys/options")
def registration_start(request: Request, context: RecentSignIn) -> JSONResponse:
    """A registration challenge for this session, and the options to use it."""
    challenge = secrets.token_bytes(CHALLENGE_BYTES)
    user = passkeys.start_registration(context, challenge_hash(challenge))
    # Returned, not raised: raising would roll the count of starts back.
    if user == "limited":
        after = retry_after(time.time(), STARTS_WINDOW)
        return error_response(429, "too_many_requests", {"Retry-After": str(after)})
    if user == "too_many":
        return error_response(409, "too_many_passkeys")
    return JSONResponse(
        registration_options(
            site_state(request).settings.site_origin,
            challenge=challenge,
            user_handle=user.user_handle,
            email=user.email,
            existing=user.existing,
        )
    )


@router.post("/passkeys")
def register(raw: RawBody, request: Request, context: RecentSignIn, who: TheCaller) -> JSONResponse:
    body = parsed(Registration, raw)
    name = _name_of(body.name)
    origin = site_state(request).settings.site_origin
    credential = body.credential.model_dump(exclude_none=True)
    challenge = challenge_of(body.credential.response.clientDataJSON)

    def verify() -> NewPasskey | None:
        if challenge is None:
            return None
        return verified_registration(origin, credential, challenge)

    outcome = passkeys.finish_registration(
        context,
        challenge_hash=None if challenge is None else challenge_hash(challenge),
        name=name,
        verify=verify,
        client=who.info,
    )
    if outcome == "busy":
        # Raised, not returned: the challenge's use is rolled back, so the same answer can be
        # sent again after `Retry-After`. The session's "last used" is kept.
        raise ApiError(429, "too_many_requests", {"Retry-After": str(BUSY_RETRY_SECONDS)})
    if outcome == "refused":
        # One answer for a used, expired or other session's challenge and a credential that
        # fails a check: start again.
        return error_response(400, "passkey_refused")
    if outcome == "too_many":
        return error_response(409, "too_many_passkeys")
    if outcome == "exists":
        return error_response(409, "passkey_exists")
    response = JSONResponse(_shown(outcome), status_code=201)
    email = passkeys.account_email(context)
    if email is not None:
        # Section 6: a new passkey sends the account a notice, after the response.
        state = site_state(request)
        response.background = BackgroundTask(deliver, state.mailer, added_mail(origin, email))
    return response


@router.patch("/passkeys/{passkey_id}")
def rename(passkey_id: str, raw: RawBody, context: SiteSession) -> JSONResponse:
    # Raw text, parsed here: a value the framework refused would roll back "last used".
    parsed_id = uuid_of(passkey_id)
    if parsed_id is None:
        raise ApiError(422, "invalid_request")
    name = _name_of(parsed(Renaming, raw).name)
    renamed = passkeys.rename(context, parsed_id, name)
    if renamed is None:
        raise ApiError(404, "not_found")
    return JSONResponse(_shown(renamed))


@router.delete("/passkeys/{passkey_id}")
def remove(passkey_id: str, context: RecentSignIn, who: TheCaller) -> Response:
    parsed_id = uuid_of(passkey_id)
    if parsed_id is None:
        raise ApiError(422, "invalid_request")
    if not passkeys.remove(context, parsed_id, who.info):
        raise ApiError(404, "not_found")
    return Response(status_code=204)
