"""The ID token check (ADR 0010, section 3), on tokens signed with a key made here (#481).

Each check has a token that fails it, and only it: everything else in the token is right.
"""

from __future__ import annotations

from collections.abc import Sequence

import pytest

from player_backend.classbeat_policy import Identity, Json, nonce_hash
from player_backend.classbeat_token_check import (
    TOKEN_MAX,
    KeyLookup,
    TokenRefused,
    check_id_token,
)
from tests.classbeathelp import CLIENT_ID, ISSUER, KID, SigningKey, b64url, claims, header

NOW = 1_800_000_000
NONCE = "n" * 43
KEY = SigningKey()


def _keys(*keys: Json) -> KeyLookup:
    held: Sequence[Json] = keys or (KEY.jwk(),)

    def lookup(_kid: str) -> Sequence[Json]:
        return held

    return lookup


def _check(token: str, keys: KeyLookup | None = None, nonce: str = NONCE) -> Identity:
    return check_id_token(
        token,
        keys or _keys(),
        issuer=ISSUER,
        client_id=CLIENT_ID,
        expected_nonce_hash=nonce_hash(nonce),
        now=NOW,
    )


def _refusal(token: str, keys: KeyLookup | None = None) -> str:
    with pytest.raises(TokenRefused) as refused:
        _check(token, keys)
    return refused.value.reason


def _token(head: Json | None = None, /, **changes: object) -> str:
    body: dict[str, object] = claims(NONCE, NOW, email="Ann@Example.org", email_verified=True)
    for name, value in changes.items():
        if value is None:
            body.pop(name, None)
        else:
            body[name] = value
    return KEY.sign(head or header(), body)


def test_a_right_token_gives_the_identity_and_the_verified_email() -> None:
    identity = _check(_token())
    assert identity.issuer == ISSUER
    assert identity.subject == "pairwise-subject-1"
    assert identity.email == "ann@example.org"
    assert identity.auth_time == NOW


def test_an_unverified_email_is_not_kept() -> None:
    assert _check(_token(email_verified=False)).email is None
    assert _check(_token(email_verified="true")).email is None


@pytest.mark.parametrize(
    ("head", "reason"),
    [
        (header(alg="HS256"), "alg"),
        (header(alg="none"), "alg"),
        (header(alg="ES384"), "alg"),
        (header(alg="es256"), "alg"),
        ({"typ": "JWT", "kid": KID}, "alg"),
        (header(typ="logout+jwt"), "typ"),
        (header(typ="at+jwt"), "typ"),
        (header(crit=["exp"]), "crit"),
        ({"alg": "ES256", "typ": "JWT"}, "kid"),
        (header(kid="unknown-key"), "kid"),
    ],
)
def test_a_wrong_header_is_refused_before_the_signature(head: Json, reason: str) -> None:
    assert _refusal(_token(head)) == reason


def test_a_token_without_typ_is_accepted() -> None:
    assert _check(_token({"alg": "ES256", "kid": KID}))


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"iss": "https://other.test"}, "iss"),
        ({"iss": ISSUER + "/"}, "iss"),
        ({"iss": None}, "iss"),
        ({"aud": "another-client"}, "aud"),
        ({"aud": [CLIENT_ID, "another-client"]}, "aud"),
        ({"aud": None}, "aud"),
        ({"azp": "another-client"}, "azp"),
        ({"exp": NOW - 61}, "exp"),
        ({"exp": NOW - 60}, "exp"),
        ({"exp": None}, "exp"),
        ({"exp": True}, "exp"),
        ({"iat": NOW - 300 - 61}, "iat"),
        ({"iat": NOW + 61}, "iat"),
        ({"iat": None}, "iat"),
        ({"auth_time": None}, "auth_time"),
        ({"auth_time": NOW + 61}, "auth_time"),
        ({"auth_time": "now"}, "auth_time"),
        ({"nonce": "another-nonce"}, "nonce"),
        ({"nonce": None}, "nonce"),
        ({"sub": ""}, "sub"),
        ({"sub": "s" * 256}, "sub"),
        ({"sub": None}, "sub"),
    ],
)
def test_each_claim_has_its_refusal(changes: dict[str, object], reason: str) -> None:
    assert _refusal(_token(**changes)) == reason


@pytest.mark.parametrize(
    "changes",
    [
        {"aud": [CLIENT_ID]},
        {"azp": None},
        {"exp": NOW - 59},
        {"iat": NOW - 300 - 60},
        {"iat": NOW + 60},
        {"auth_time": NOW + 60},
        {"auth_time": NOW - 86400},
        {"sub": "s" * 255},
    ],
)
def test_the_bounds_themselves_pass(changes: dict[str, object]) -> None:
    assert _check(_token(**changes))


def test_a_signature_by_another_key_is_refused() -> None:
    other = SigningKey()
    assert _refusal(other.sign(header(), claims(NONCE, NOW))) == "signature"


def test_a_changed_body_breaks_the_signature() -> None:
    head, _, signature = _token().split(".")
    forged = b64url(b'{"iss":"' + ISSUER.encode() + b'","sub":"someone-else"}')
    assert _refusal(f"{head}.{forged}.{signature}") == "signature"


def test_a_key_that_is_not_an_es256_signing_key_is_not_used() -> None:
    for bad in (KEY.jwk(kty="RSA"), KEY.jwk(crv="P-384"), KEY.jwk(use="enc"), KEY.jwk(alg="RS256")):
        assert _refusal(_token(), _keys(bad)) == "kid"


def test_two_keys_with_the_kid_are_refused() -> None:
    assert _refusal(_token(), _keys(KEY.jwk(), SigningKey().jwk())) == "kid"


def test_the_kid_is_looked_up_in_the_keys_the_lookup_gives() -> None:
    asked: list[str] = []

    def lookup(kid: str) -> Sequence[Json]:
        asked.append(kid)
        return (KEY.jwk(),)

    _check(_token(), lookup)
    assert asked == [KID]


@pytest.mark.parametrize(
    "token",
    [
        "",
        "a.b",
        "a.b.c.d",
        "x" * (TOKEN_MAX + 1),
        "é.b.c",
        "eyJhbGciOiJFUzI1NiJ9=.e30.AA",
        "eyJh bGciOiJFUzI1NiJ9.e30.AA",
        b64url(b"[1]") + ".e30.AA",
        b64url(b'{"alg": NaN}') + ".e30.AA",
    ],
)
def test_a_malformed_token_is_refused_by_its_form(token: str) -> None:
    assert _refusal(token) == "form"


@pytest.mark.parametrize("value", [float("inf"), float("-inf"), float("nan")])
def test_a_number_that_is_not_finite_is_not_json(value: float) -> None:
    # Python's encoder writes these as words that JSON does not have; a signed token with one
    # is refused by its form, never read as a time.
    assert _refusal(_token(exp=value)) == "form"
