"""The pure rules of the classbeat flow (ADR 0010, sections 2 and 6; #481)."""

from __future__ import annotations

import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

import pytest

from player_backend.classbeat_flow_policy import (
    Purpose,
    authorize_address,
    callback_values,
    code_challenge,
    is_navigation,
    return_path,
)
from player_backend.token_issue import new_token

ISSUER = "https://classbeat.test"
STATE = "s" * 43


def _address(purpose: Purpose) -> dict[str, list[str]]:
    address = authorize_address(
        ISSUER + "/oauth/authorize",
        client_id="client",
        redirect_uri="https://player.test/api/site/sign-in/classbeat/callback",
        state=STATE,
        nonce="n" * 43,
        challenge="c" * 43,
        purpose=purpose,
    )
    parts = urlsplit(address)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == ISSUER + "/oauth/authorize"
    return parse_qs(parts.query, strict_parsing=True)


def test_the_authorize_address_asks_for_a_code_with_pkce_s256() -> None:
    query = _address("sign_in")
    assert query == {
        "response_type": ["code"],
        "client_id": ["client"],
        "redirect_uri": ["https://player.test/api/site/sign-in/classbeat/callback"],
        "scope": ["openid email"],
        "state": [STATE],
        "nonce": ["n" * 43],
        "code_challenge": ["c" * 43],
        "code_challenge_method": ["S256"],
    }


def test_only_a_re_authentication_adds_prompt_login() -> None:
    assert "prompt" not in _address("sign_in")
    assert _address("reauth")["prompt"] == ["login"]
    assert "max_age" not in _address("reauth")


def test_the_challenge_is_s256_of_the_binding_token() -> None:
    verifier = new_token("cbs")
    assert len(verifier) == 51
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    assert code_challenge(verifier) == expected.decode()


@pytest.mark.parametrize(
    ("mode", "dest", "accepted"),
    [
        ("navigate", "document", True),
        (None, None, True),
        ("navigate", None, True),
        (None, "document", True),
        ("cors", "document", False),
        ("no-cors", "document", False),
        ("navigate", "iframe", False),
        ("navigate", "empty", False),
        ("same-origin", "empty", False),
    ],
)
def test_the_callback_is_a_top_level_navigation(
    mode: str | None, dest: str | None, accepted: bool
) -> None:
    assert is_navigation(mode, dest) is accepted


@pytest.mark.parametrize(
    "items",
    [
        [("code", "abc"), ("state", STATE), ("iss", ISSUER)],
        [("code", "abc"), ("state", STATE)],
        [("state", STATE), ("code", "a" * 512)],
    ],
)
def test_a_callback_query_gives_its_code_and_state(items: list[tuple[str, str]]) -> None:
    assert callback_values(items, ISSUER) == (dict(items)["code"], STATE)


@pytest.mark.parametrize(
    "items",
    [
        [],
        [("state", STATE)],
        [("code", "abc")],
        [("code", "abc"), ("state", STATE), ("error", "access_denied")],
        [("error", "access_denied"), ("state", STATE)],
        [("code", "abc"), ("state", STATE), ("state", STATE)],
        [("code", "abc"), ("code", "abd"), ("state", STATE)],
        [("code", "abc"), ("state", STATE), ("iss", "https://other.test")],
        [("code", "abc"), ("state", STATE), ("return", "x")],
        [("code", "abc"), ("state", "short")],
        [("code", "abc"), ("state", STATE + "x")],
        [("code", ""), ("state", STATE)],
        [("code", "a" * 513), ("state", STATE)],
        [("code", "a b"), ("state", STATE)],
        [("code", "é"), ("state", STATE)],
    ],
)
def test_any_other_callback_query_is_refused(items: list[tuple[str, str]]) -> None:
    assert callback_values(items, ISSUER) is None


@pytest.mark.parametrize(
    ("entry", "path"),
    [
        (None, "/classes"),
        ("control", "/control"),
        ("control.BCDF-GHJK", "/control#BCDF-GHJK"),
        ("play", "/play"),
        ("play.0b6f4c2e-1a2b-4c3d-8e9f-0123456789ab", "/play#0b6f4c2e-1a2b-4c3d-8e9f-0123456789ab"),
        ("elsewhere", "/classes"),
        ("//evil.test", "/classes"),
    ],
)
def test_the_way_back_is_the_return_entrys_page_with_the_rest_in_the_fragment(
    entry: str | None, path: str
) -> None:
    assert return_path(entry) == path
