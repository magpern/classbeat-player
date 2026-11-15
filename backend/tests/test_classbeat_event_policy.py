"""The pure rules of the events route (ADR 0010, section 8; #496): the browser check, the form
and its one field, and the hashes kept."""

from __future__ import annotations

import hashlib

import pytest

from player_backend.classbeat_event_policy import (
    JTI_KEPT,
    LIMIT_MAX,
    LIMIT_WINDOW,
    from_browser,
    is_form,
    jti_hash,
    limit_key,
    logout_token_of,
)


@pytest.mark.parametrize("value", ["same-origin", "same-site", "cross-site", "none", ""])
def test_any_sec_fetch_site_is_a_browser(value: str) -> None:
    assert from_browser(value)


def test_no_sec_fetch_site_is_a_server() -> None:
    assert not from_browser(None)


@pytest.mark.parametrize(
    ("content_type", "form"),
    [
        ("application/x-www-form-urlencoded", True),
        ("Application/X-WWW-Form-Urlencoded; charset=UTF-8", True),
        ("application/json", False),
        ("multipart/form-data; boundary=x", False),
        ("text/plain", False),
        (None, False),
    ],
)
def test_the_body_is_a_form(content_type: str | None, form: bool) -> None:
    assert is_form(content_type) is form


@pytest.mark.parametrize(
    ("raw", "token"),
    [
        (b"logout_token=a.b.c", "a.b.c"),
        (b"logout_token=a%2Eb.c", "a.b.c"),
        (b"", None),
        (b"logout_token=", None),
        (b"logout_token", None),
        (b"token=a.b.c", None),
        (b"logout_token=a.b.c&logout_token=d.e.f", None),
        (b"logout_token=a.b.c&extra=1", None),
        (b"logout_token=a.b.c&", None),
        ("logout_token=é".encode(), None),
    ],
)
def test_the_form_holds_one_logout_token_and_nothing_else(raw: bytes, token: str | None) -> None:
    assert logout_token_of(raw) == token


def test_the_kept_values_are_hashes() -> None:
    assert jti_hash("event-1") == hashlib.sha256(b"event-1").digest()
    address = b"a" * 32
    assert limit_key(address) == hashlib.sha256(b"classbeat.events:" + address).digest()
    assert address not in limit_key(address)


def test_the_numbers_are_the_adrs() -> None:
    assert JTI_KEPT.days == 8
    assert (LIMIT_MAX, LIMIT_WINDOW.total_seconds()) == (600, 60)
