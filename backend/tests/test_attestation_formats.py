"""Attestation formats at registration (ADR 0002, section 4): only `none` is taken. Any other
format is refused before the library checks it, so no attestation statement is ever parsed by
pyOpenSSL or pyasn1. Pure: no database, no network."""

from __future__ import annotations

import secrets
from typing import cast

import pytest
import webauthn.registration.verify_registration_response as library
from webauthn import verify_registration_response

from player_backend.passkey_policy import rp_id_of
from player_backend.webauthn_check import registration_options, verified_registration
from tests.passkeyhelp import Authenticator, b64
from tests.sitehelp import ORIGIN

# The library's checks of each format other than `none`, by the name it imports them under.
VERIFIERS = (
    "verify_fido_u2f",
    "verify_packed",
    "verify_tpm",
    "verify_apple",
    "verify_android_safetynet",
    "verify_android_key",
)
FORMATS = ("packed", "fido-u2f", "tpm", "apple", "android-safetynet", "android-key", "other")


def _answer(fmt: str) -> tuple[dict[str, object], bytes]:
    challenge = secrets.token_bytes(32)
    options = registration_options(
        ORIGIN, challenge=challenge, user_handle=b"u" * 16, email="a@example.test", existing=[]
    )
    return Authenticator().create(options, fmt=fmt), challenge


@pytest.fixture
def called(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Which of the library's format checks ran."""
    seen: list[str] = []
    for name in VERIFIERS:

        def spy(*_: object, _name: str = name, **__: object) -> bool:
            seen.append(_name)
            return True

        monkeypatch.setattr(library, name, spy)
    return seen


def test_attestation_none_is_taken(called: list[str]) -> None:
    credential, challenge = _answer("none")
    assert verified_registration(ORIGIN, credential, challenge) is not None
    assert called == []


@pytest.mark.parametrize("fmt", FORMATS)
def test_any_other_format_is_refused_before_its_check(called: list[str], fmt: str) -> None:
    credential, challenge = _answer(fmt)
    assert verified_registration(ORIGIN, credential, challenge) is None
    # Even with every format check spied to pass, none of them was reached.
    assert called == []


def test_a_valid_packed_self_attestation_is_refused() -> None:
    """The library itself would take this one: the refusal is ours."""
    credential, challenge = _answer("packed")
    found = verify_registration_response(
        credential=credential,
        expected_challenge=challenge,
        expected_rp_id=rp_id_of(ORIGIN),
        expected_origin=ORIGIN,
        require_user_verification=True,
    )
    assert found.fmt == "packed"
    assert verified_registration(ORIGIN, credential, challenge) is None


@pytest.mark.parametrize(
    "attestation", [None, 5, "", "!!", b64(b"\xa0"), b64(b"\x80"), b64(b"\xa1cfmtdnone")]
)
def test_an_attestation_object_that_is_not_one_is_refused(attestation: object) -> None:
    credential, challenge = _answer("none")
    response = dict(cast(dict[str, object], credential["response"]))
    response["attestationObject"] = attestation
    assert verified_registration(ORIGIN, {**credential, "response": response}, challenge) is None
