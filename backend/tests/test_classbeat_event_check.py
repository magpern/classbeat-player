"""The check of an event token (ADR 0010, sections 3 and 8; #496), on tokens signed with a key
made here.

Each check has a token that fails it, and only it: everything else in the token is right.
"""

from __future__ import annotations

from collections.abc import Sequence

import pytest

from player_backend.classbeat_event_policy import Event
from player_backend.classbeat_policy import Json
from player_backend.classbeat_token_check import KeyLookup, TokenRefused, check_event_token
from tests.classbeathelp import (
    ACCOUNT_DELETED,
    BACKCHANNEL,
    CLIENT_ID,
    ISSUER,
    SESSIONS_REVOKED,
    SigningKey,
    event_claims,
    event_header,
    header,
)

NOW = 1_800_000_000
KEY = SigningKey()
JTI = "event-id-1"
SUBJECT = "pairwise-subject-1"


def _keys(*keys: Json) -> KeyLookup:
    held: Sequence[Json] = keys or (KEY.jwk(),)

    def lookup(_kid: str) -> Sequence[Json]:
        return held

    return lookup


def _check(token: str, keys: KeyLookup | None = None) -> Event:
    return check_event_token(token, keys or _keys(), issuer=ISSUER, client_id=CLIENT_ID, now=NOW)


def _refusal(token: str, keys: KeyLookup | None = None) -> str:
    with pytest.raises(TokenRefused) as refused:
        _check(token, keys)
    return refused.value.reason


def _token(head: Json | None = None, event: str = ACCOUNT_DELETED, /, **changes: object) -> str:
    body = event_claims(event, NOW, SUBJECT, JTI)
    for name, value in changes.items():
        if value is None:
            body.pop(name, None)
        else:
            body[name] = value
    return KEY.sign(head or event_header(), body)


@pytest.mark.parametrize(
    ("event", "kind"),
    [(ACCOUNT_DELETED, "account_deleted"), (SESSIONS_REVOKED, "sessions_revoked")],
)
def test_a_right_token_gives_its_event(event: str, kind: str) -> None:
    assert _check(_token(None, event)) == Event(ISSUER, SUBJECT, JTI, kind)  # pyright: ignore[reportArgumentType]


def test_a_bad_signature_is_refused() -> None:
    other = SigningKey()
    forged = other.sign(event_header(), event_claims(ACCOUNT_DELETED, NOW, SUBJECT, JTI))
    assert _refusal(forged) == "signature"
    head, body, _ = _token().split(".")
    _, _, signature = forged.split(".")
    assert _refusal(f"{head}.{body}.{signature}") == "signature"


@pytest.mark.parametrize(
    ("head", "reason"),
    [
        (event_header(alg="HS256"), "alg"),
        (event_header(alg="none"), "alg"),
        # An ID token's type, or none, is not an event token's.
        (header(), "typ"),
        ({"alg": "ES256", "kid": "test-key-1"}, "typ"),
        (event_header(typ="JWT"), "typ"),
        (event_header(kid="another-key"), "kid"),
        (event_header(crit=["exp"]), "crit"),
    ],
)
def test_the_header_is_checked(head: Json, reason: str) -> None:
    assert _refusal(_token(head)) == reason


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"iss": "https://other.test"}, "iss"),
        ({"iss": None}, "iss"),
        ({"aud": "another-client"}, "aud"),
        ({"aud": [CLIENT_ID, "another-client"]}, "aud"),
        ({"aud": None}, "aud"),
        ({"azp": "another-client"}, "azp"),
        # `iat` more than 5 minutes (and the allowed 60 seconds) old, or in the future.
        ({"iat": NOW - 361}, "iat"),
        ({"iat": NOW + 61}, "iat"),
        ({"iat": None}, "iat"),
        # `exp` required, and in the future.
        ({"exp": None}, "exp"),
        ({"exp": NOW - 61}, "exp"),
        ({"exp": "soon"}, "exp"),
        ({"nonce": "n" * 43}, "nonce"),
        ({"nonce": ""}, "nonce"),
        ({"sub": None}, "sub"),
        ({"sub": ""}, "sub"),
        ({"sub": "s" * 256}, "sub"),
        ({"jti": None}, "jti"),
        ({"jti": ""}, "jti"),
        ({"jti": 7}, "jti"),
        ({"jti": "j" * 256}, "jti"),
        ({"events": None}, "events"),
        ({"events": []}, "events"),
        # An extra member, both events, neither, a value that is not `{}`, another name.
        ({"events": {BACKCHANNEL: {}, ACCOUNT_DELETED: {}, "urn:x": {}}}, "events"),
        ({"events": {BACKCHANNEL: {}, ACCOUNT_DELETED: {}, SESSIONS_REVOKED: {}}}, "events"),
        ({"events": {BACKCHANNEL: {}}}, "events"),
        ({"events": {ACCOUNT_DELETED: {}}}, "events"),
        ({"events": {}}, "events"),
        ({"events": {BACKCHANNEL: {}, ACCOUNT_DELETED: {"why": 1}}}, "events"),
        ({"events": {BACKCHANNEL: [], ACCOUNT_DELETED: {}}}, "events"),
        ({"events": {BACKCHANNEL: {}, "urn:classbeat:player:other": {}}}, "events"),
        ({"events": {"urn:x": {}, ACCOUNT_DELETED: {}}}, "events"),
    ],
)
def test_each_claim_is_checked(changes: dict[str, object], reason: str) -> None:
    assert _refusal(_token(**changes)) == reason


def test_the_times_allow_60_seconds_of_clock_difference() -> None:
    assert _check(_token(iat=NOW - 360)).jti == JTI
    assert _check(_token(iat=NOW + 60)).jti == JTI
    assert _check(_token(exp=NOW - 59)).jti == JTI


def test_a_token_of_another_form_is_refused() -> None:
    for token in ("", "a.b", "a.b.c.d", _token() + "é", _token().replace(".", "..", 1)):
        assert _refusal(token) == "form"


def test_an_id_token_is_not_an_event() -> None:
    # Signed with the right key, for the right client, but typed as an ID token.
    token = KEY.sign(header(), event_claims(SESSIONS_REVOKED, NOW, SUBJECT, JTI))
    assert _refusal(token) == "typ"
