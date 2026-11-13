"""Limits on starting a passkey challenge (ADR 0002, section 10): 30 sign-in challenges per
address and 30 registration challenges per account, each per 10 minutes, then 429. A refused
start stores no challenge; the start at the limit still works."""

from __future__ import annotations

import time

import pytest

from player_backend.passkey_policy import STARTS_MAX
from tests.passkeyhelp import OPTIONS, SIGN_IN_OPTIONS, Authenticator, options_of, register
from tests.sitehelp import LOGIN_COOKIE, Site

A = "a@example.test"
B = "b@example.test"
LIMITED = {"error": "too_many_requests"}


@pytest.fixture(autouse=True)
def _away_from_a_window_edge() -> None:  # pyright: ignore[reportUnusedFunction]
    """The windows are fixed, 10 minutes long: do not let one end mid-test."""
    left = 600 - time.time() % 600
    if left < 10:
        time.sleep(left + 0.1)


def _challenges(site: Site) -> object:
    row = site.su.execute("SELECT count(*) FROM player.login_challenges").fetchone()
    return None if row is None else row[0]


def _registrations(site: Site) -> object:
    row = site.su.execute("SELECT count(*) FROM player.passkey_registrations").fetchone()
    return None if row is None else row[0]


def test_the_limit_is_thirty_starts() -> None:
    assert STARTS_MAX == 30


def test_thirty_sign_in_starts_per_address_then_429(site: Site) -> None:
    address = "198.51.100.20"
    # A browser without its token each time: every start would add a challenge row.
    for _ in range(30):
        assert site.browser(address).post(SIGN_IN_OPTIONS).status_code == 200
    assert _challenges(site) == 30
    late = site.browser(address)
    limited = late.post(SIGN_IN_OPTIONS)
    assert limited.status_code == 429 and limited.json() == LIMITED
    assert 1 <= int(limited.headers["Retry-After"]) <= 600
    # Nothing stored past the limit, and no browser token handed out.
    assert _challenges(site) == 30
    assert late.cookies.get(LOGIN_COOKIE) is None
    # A browser that has its token is counted the same; other addresses keep working.
    assert site.browser(address).post(SIGN_IN_OPTIONS).status_code == 429
    assert site.browser("198.51.100.21").post(SIGN_IN_OPTIONS).status_code == 200


def test_a_sign_in_start_over_the_limit_does_not_replace_the_browsers_challenge(
    site: Site,
) -> None:
    site.allow(A)
    authenticator = Authenticator()
    assert register(site.sign_in(A), authenticator).status_code == 201
    browser = site.browser("198.51.100.22")
    options = options_of(browser.post(SIGN_IN_OPTIONS))
    for _ in range(29):
        assert site.browser("198.51.100.22").post(SIGN_IN_OPTIONS).status_code == 200
    assert browser.post(SIGN_IN_OPTIONS).status_code == 429
    # The challenge from before the limit still signs in.
    answer = browser.post(
        "/api/site/sign-in/passkey", json={"credential": authenticator.get(options)}
    )
    assert answer.status_code == 200


def test_thirty_registration_starts_per_account_then_429(site: Site) -> None:
    site.allow(A)
    site.allow(B)
    first = site.sign_in(A)
    for _ in range(15):
        assert first.post(OPTIONS).status_code == 200
    # Another session of the same account shares the account's count.
    second = site.sign_in(A, site.browser("198.51.100.23"))
    for _ in range(15):
        assert second.post(OPTIONS).status_code == 200
    assert _registrations(site) == 2
    for browser in (first, second):
        limited = browser.post(OPTIONS)
        assert limited.status_code == 429 and limited.json() == LIMITED
        assert 1 <= int(limited.headers["Retry-After"]) <= 600
    # Nothing stored or dropped past the limit; another account keeps working.
    assert _registrations(site) == 2
    assert site.sign_in(B).post(OPTIONS).status_code == 200


def test_a_registration_start_over_the_limit_keeps_the_sessions_challenge(site: Site) -> None:
    site.allow(A)
    browser = site.sign_in(A)
    for _ in range(29):
        assert browser.post(OPTIONS).status_code == 200
    authenticator = Authenticator()
    credential = authenticator.create(options_of(browser.post(OPTIONS)))  # the thirtieth
    assert browser.post(OPTIONS).status_code == 429
    answer = browser.post("/api/site/passkeys", json={"name": "Laptop", "credential": credential})
    assert answer.status_code == 201
