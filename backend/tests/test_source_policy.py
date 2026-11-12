"""The pure rules of linking a source (source_policy.py) and the known-sources setting."""

from __future__ import annotations

import json

import pytest

from player_backend.settings import Settings, SettingsError
from player_backend.source_policy import (
    KnownSource,
    SourcesError,
    back_to_source,
    bearer_source_token,
    exchange_limit_key,
    find_source,
    known_source,
    requests_key,
    valid_challenge,
    valid_redirect,
    valid_state,
)
from player_backend.token_issue import new_token

REDIRECT = "https://classbeat.test/player/linked"
ENTRY = {"id": "classbeat", "name": "classbeat", "redirect_uris": [REDIRECT]}
BASE = {"PLAYER_DATABASE_URL": "postgresql://x", "PLAYER_SITE_ORIGIN": "https://player.test"}


@pytest.mark.parametrize(
    "uri",
    [REDIRECT, "https://classbeat.test", "http://127.0.0.1:8080/cb", "http://localhost/cb"],
)
def test_allowed_redirect_addresses(uri: str) -> None:
    assert valid_redirect(uri)


@pytest.mark.parametrize(
    "uri",
    [
        "",
        "http://classbeat.test/cb",
        "https://classbeat.test/cb?x=1",
        "https://classbeat.test/cb#x",
        "https://user@classbeat.test/cb",
        "https://classbeat.test/c b",
        "javascript:alert(1)",
        "https:///nohost",
        "https://classbeat.test/" + "x" * 2000,
        None,
    ],
)
def test_refused_redirect_addresses(uri: object) -> None:
    assert not valid_redirect(uri)


def test_a_known_source_is_found_only_with_its_exact_address() -> None:
    sources = (known_source(ENTRY),)
    assert find_source(sources, "classbeat", REDIRECT) == sources[0]
    assert find_source(sources, "classbeat", REDIRECT + "/") is None
    assert find_source(sources, "classbeat", REDIRECT.upper()) is None
    assert find_source(sources, "other", REDIRECT) is None
    assert find_source((), "classbeat", REDIRECT) is None


@pytest.mark.parametrize(
    "entry",
    [
        [],
        {**ENTRY, "id": "Classbeat"},
        {**ENTRY, "name": ""},
        {**ENTRY, "redirect_uris": []},
        {**ENTRY, "redirect_uris": ["http://classbeat.test/"]},
        {**ENTRY, "redirect_uris": [5]},
        {**ENTRY, "extra": 1},
    ],
)
def test_a_bad_entry_of_the_setting_is_refused(entry: object) -> None:
    with pytest.raises(SourcesError):
        known_source(entry)


def test_the_setting_is_read_from_the_environment() -> None:
    assert Settings.from_env(BASE).sources == ()
    settings = Settings.from_env({**BASE, "PLAYER_SOURCES": json.dumps([ENTRY])})
    assert settings.sources == (KnownSource("classbeat", "classbeat", frozenset({REDIRECT})),)
    for bad in ("{", "{}", json.dumps([ENTRY, ENTRY]), json.dumps([{"id": "x"}])):
        with pytest.raises(SettingsError) as raised:
            Settings.from_env({**BASE, "PLAYER_SOURCES": bad})
        assert REDIRECT not in str(raised.value)


def test_challenge_and_state() -> None:
    assert valid_challenge("A" * 43, "S256") and valid_challenge("a-_" * 14 + "b", None)
    assert not valid_challenge("A" * 43, "plain")
    assert not valid_challenge("A" * 42, "S256") and not valid_challenge("A" * 44, "S256")
    assert not valid_challenge("=" * 43, "S256")
    assert valid_state("x") and valid_state("~" * 500)
    assert not valid_state("") and not valid_state("a b") and not valid_state("x" * 501)
    assert not valid_state("é") and not valid_state(None)


def test_the_way_back_holds_the_code_and_the_state_in_the_query() -> None:
    assert (
        back_to_source(REDIRECT, "cbp_lc_x", "a&b=c") == REDIRECT + "?code=cbp_lc_x&state=a%26b%3Dc"
    )


def test_a_source_token_is_taken_only_from_a_bearer_header() -> None:
    token = new_token("src")
    assert bearer_source_token("Bearer " + token) == token
    assert bearer_source_token("bearer " + token) == token
    for header in (None, "", token, "Basic " + token, "Bearer " + new_token("dev"), "Bearer x"):
        assert bearer_source_token(header) is None


def test_the_counters_keys_differ_by_what_they_count() -> None:
    digest = b"x" * 32
    assert exchange_limit_key(digest) != requests_key(digest)
    assert len(exchange_limit_key(digest)) == 32 and len(requests_key(digest)) == 32
