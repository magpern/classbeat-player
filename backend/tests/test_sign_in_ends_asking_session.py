"""A sign-in ends the session the browser held (ADR 0002, section 5; #427).

"Confirm it is you" signs in again in the same browser, by passkey or by link. The new session
replaces the old one in the cookie, and the old one is ended as signing out ends it, so the
sessions list shows no second row for the browser. A refused sign-in ends nothing, and a
sign-in ends no session but the one in its own cookie.
"""

from __future__ import annotations

import time

import pytest

from tests.passkeyhelp import Authenticator, register, sign_in
from tests.sitehelp import SESSION_COOKIE, Browser, Site

A = "a@example.test"
B = "b@example.test"
SESSIONS = "/api/site/sessions"


@pytest.fixture(autouse=True)
def _away_from_a_window_edge() -> None:  # pyright: ignore[reportUnusedFunction]
    """The passkey limit's windows are fixed, 10 minutes long: do not let one end mid-test."""
    left = 600 - time.time() % 600
    if left < 5:
        time.sleep(left + 0.1)


def _sessions(site: Site, email: str) -> int:
    row = site.su.execute(
        "SELECT count(*) FROM player.sessions s JOIN player.accounts a ON a.id = s.account_id "
        "WHERE a.email = %s",
        (email,),
    ).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


def _holding(site: Site, browser: Browser) -> Browser:
    """Another browser that holds a copy of `browser`'s cookies as they are now."""
    copy = site.browser()
    copy.take_cookies(browser)
    return copy


def _signed_out_events(site: Site, email: str) -> list[object]:
    return [d for e, d in site.events(email) if e == "session.signed_out"]


def _with_passkey(site: Site, email: str, authenticator: Authenticator) -> Browser:
    site.follower(email)
    browser = site.link_sign_in(email)
    assert register(browser, authenticator).status_code == 201
    return browser


def _one_current_row(browser: Browser) -> None:
    listed = browser.get(SESSIONS).json()["sessions"]
    assert len(listed) == 1 and listed[0]["current"] is True


def test_confirming_by_passkey_ends_the_session_that_asked(site: Site) -> None:
    authenticator = Authenticator()
    browser = _with_passkey(site, A, authenticator)
    old = _holding(site, browser)
    assert _sessions(site, A) == 1
    assert sign_in(browser, authenticator).status_code == 200
    assert browser.cookies.get(SESSION_COOKIE) != old.cookies.get(SESSION_COOKIE)
    assert _sessions(site, A) == 1
    _one_current_row(browser)
    # The old token is no live session any more, and the ending is the usual event.
    assert old.get(SESSIONS).status_code == 401
    assert _signed_out_events(site, A) == [{"current": True}]


def test_confirming_by_link_ends_the_session_that_asked(site: Site) -> None:
    site.follower(A)
    browser = site.link_sign_in(A)
    old = _holding(site, browser)
    site.link_sign_in(A, browser)
    assert _sessions(site, A) == 1
    _one_current_row(browser)
    assert old.get(SESSIONS).status_code == 401
    assert _signed_out_events(site, A) == [{"current": True}]


def test_a_refused_passkey_sign_in_ends_nothing(site: Site) -> None:
    _with_passkey(site, A, Authenticator())
    browser = site.link_sign_in(A)
    assert _sessions(site, A) == 2
    # A passkey the backend does not know: refused, and the browser's session stays.
    assert sign_in(browser, Authenticator()).status_code == 401
    assert _sessions(site, A) == 2
    assert browser.get(SESSIONS).status_code == 200
    assert _signed_out_events(site, A) == []


def test_a_refused_link_ends_nothing(site: Site) -> None:
    site.follower(A)
    browser = site.link_sign_in(A)
    token = site.ask(browser, A)
    assert token is not None
    assert browser.post("/api/site/sign-in/complete", json={"token": token}).status_code == 200
    used = browser.post("/api/site/sign-in/complete", json={"token": token})
    assert used.status_code == 401
    assert _sessions(site, A) == 1
    assert browser.get(SESSIONS).status_code == 200


def test_a_sign_in_ends_no_session_of_another_browser(site: Site) -> None:
    authenticator = Authenticator()
    first = _with_passkey(site, A, authenticator)
    second = site.browser("198.51.100.4")
    assert sign_in(second, authenticator).status_code == 200
    assert _sessions(site, A) == 2
    assert first.get(SESSIONS).status_code == 200
    assert _signed_out_events(site, A) == []


def test_a_cookie_of_an_ended_session_ends_nothing_and_signs_in(site: Site) -> None:
    authenticator = Authenticator()
    browser = _with_passkey(site, A, authenticator)
    other = site.link_sign_in(A)
    stale = _holding(site, browser)
    assert browser.post("/api/site/sign-out").status_code == 204
    events = len(site.events(A))
    # `stale` still sends the ended token: there is nothing to end, and the sign-in works.
    assert sign_in(stale, authenticator).status_code == 200
    assert _sessions(site, A) == 2
    assert other.get(SESSIONS).status_code == 200
    assert _signed_out_events(site, A) == [{"current": True}]  # the sign-out's own
    assert len(site.events(A)) == events + 1  # the sign-in's event, and no ending


def test_a_passkey_of_another_account_ends_this_browsers_session_only(site: Site) -> None:
    # Confirming can switch accounts on a shared authenticator (ADR 0002, section 4): the
    # browser's session of A is ended as signing out would end it; A's other sessions stay.
    theirs = Authenticator()
    _with_passkey(site, B, theirs)
    site.follower(A)
    browser = site.link_sign_in(A)
    elsewhere = site.link_sign_in(A)
    assert sign_in(browser, theirs).status_code == 200
    assert _sessions(site, A) == 1
    assert elsewhere.get(SESSIONS).status_code == 200
    assert _signed_out_events(site, A) == [{"current": True}]
    assert browser.get("/api/site/me").json()["email"] == B
