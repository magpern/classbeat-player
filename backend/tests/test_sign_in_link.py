"""Email link sign-in through the site's API (ADR 0002, section 4): success, expiry, reuse, the
wrong browser, the allowlist, and what the answer tells (nothing)."""

from __future__ import annotations

import pytest

from player_backend.db import login
from player_backend.token_policy import is_token
from tests.sitehelp import LOGIN_COOKIE, ORIGIN, SESSION_COOKIE, Site

EMAIL = "rider@example.test"
COMPLETE = "/api/site/sign-in/complete"
LINK = "/api/site/sign-in/link"


def _cookie(response_headers: list[str], name: str) -> dict[str, str]:
    """The attributes of the one cookie `name` among the response's cookie headers."""
    found = [h for h in response_headers if h.startswith(name + "=")]
    assert len(found) == 1
    parts = [part.strip() for part in found[0].split(";")]
    attributes = {"value": parts[0].partition("=")[2]}
    for part in parts[1:]:
        key, _, value = part.partition("=")
        attributes[key.lower()] = value
    return attributes


def test_a_first_sign_in_creates_the_account_and_a_session(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.first
    asked = browser.post(LINK, json={"email": "  Rider@Example.Test "})
    assert asked.status_code == 200 and asked.json() == {"status": "accepted"}
    # The browser token (section 4): one hour, and it signs nobody in.
    login = _cookie(asked.headers.get_list("set-cookie"), LOGIN_COOKIE)
    assert is_token("lgn", login["value"])
    assert login["max-age"] == "3600" and login["path"] == "/" and login["samesite"] == "lax"
    assert "secure" in login and "httponly" in login and "domain" not in login
    assert browser.get("/api/site/sessions").status_code == 401

    (mail,) = site.mailer.sent
    assert mail.to == EMAIL
    link = next(word for word in mail.body.split() if word.startswith("https://"))
    address, _, token = link.partition("#")
    assert address == ORIGIN + "/sign-in" and is_token("ml", token)

    done = browser.post(COMPLETE, json={"token": token})
    assert done.status_code == 200 and done.json() == {"status": "signed_in"}
    session = _cookie(done.headers.get_list("set-cookie"), SESSION_COOKIE)
    assert is_token("ses", session["value"])
    # Section 5: Max-Age equals the absolute lifetime, 60 days.
    assert session["max-age"] == str(60 * 24 * 3600)
    assert session["path"] == "/" and session["samesite"] == "lax"
    assert "secure" in session and "httponly" in session and "domain" not in session

    listed = browser.get("/api/site/sessions").json()["sessions"]
    assert [(s["current"], s["browser"]) for s in listed] == [(True, "Firefox")]
    assert site.su.execute("SELECT email FROM player.accounts").fetchall() == [(EMAIL,)]
    assert site.su.execute("SELECT count(*) FROM player.login_links").fetchone() == (0,)
    assert site.events(EMAIL) == [("login.signed_in", {"method": "link", "account_created": True})]


def test_a_later_sign_in_uses_the_account_and_issues_a_new_token(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    before = browser.cookies.get(SESSION_COOKIE)
    site.sign_in(EMAIL, browser)
    assert browser.cookies.get(SESSION_COOKIE) != before
    assert site.su.execute("SELECT count(*) FROM player.accounts").fetchone() == (1,)
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (2,)
    assert [event for event, _ in site.events(EMAIL)] == [
        "login.signed_in",
        "login.link_requested",
        "login.signed_in",
    ]
    assert site.events(EMAIL)[2] == (
        "login.signed_in",
        {"method": "link", "account_created": False},
    )


def test_a_link_works_once(site: Site) -> None:
    site.allow(EMAIL)
    token = site.ask(site.first, EMAIL)
    assert site.first.post(COMPLETE, json={"token": token}).status_code == 200
    again = site.first.post(COMPLETE, json={"token": token})
    assert again.status_code == 401 and again.json() == {"error": "sign_in_refused"}
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)


def test_a_link_is_refused_after_15_minutes(site: Site) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)  # the account exists, so the refusal is an event
    browser = site.browser()
    token = site.ask(browser, EMAIL)
    lifetime = site.su.execute(
        "SELECT extract(epoch FROM expires_at - created_at)::int FROM player.login_links"
    ).fetchone()
    assert lifetime == (900,)
    site.su.execute("UPDATE player.login_links SET expires_at = now() - interval '1 second'")
    refused = browser.post(COMPLETE, json={"token": token})
    assert refused.status_code == 401 and SESSION_COOKIE not in refused.headers.get(
        "set-cookie", ""
    )
    assert site.events(EMAIL)[-1] == ("login.refused", {"reason": "expired"})
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)


def test_a_link_works_only_in_the_browser_that_asked(site: Site) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)
    asking, other, bare = site.browser(), site.browser(), site.browser()
    token = site.ask(asking, EMAIL)
    site.ask(other, "someone@example.test")  # another browser, with a browser token of its own
    for stranger in (other, bare):
        refused = stranger.post(COMPLETE, json={"token": token})
        assert refused.status_code == 401 and refused.json() == {"error": "sign_in_refused"}
        assert stranger.cookies.get(SESSION_COOKIE) is None
    assert site.events(EMAIL)[-2:] == [("login.refused", {"reason": "other_browser"})] * 2
    # A forwarded or stolen mail uses nothing up: the asking browser still signs in.
    assert asking.post(COMPLETE, json={"token": token}).status_code == 200


def test_a_newer_link_cancels_older_ones_from_the_same_browser_only(site: Site) -> None:
    site.allow(EMAIL)
    mine, theirs = site.browser(), site.browser("198.51.100.4")
    first = site.ask(mine, EMAIL)
    elsewhere = site.ask(theirs, EMAIL)
    second = site.ask(mine, EMAIL)
    assert mine.post(COMPLETE, json={"token": first}).status_code == 401
    assert theirs.post(COMPLETE, json={"token": elsewhere}).status_code == 200
    assert mine.post(COMPLETE, json={"token": second}).status_code == 200


def test_an_address_not_on_the_allowlist_gets_the_same_answer_and_no_mail(site: Site) -> None:
    site.allow(EMAIL)
    allowed = site.first.post(LINK, json={"email": EMAIL})
    unknown = site.browser().post(LINK, json={"email": "stranger@example.test"})
    assert (unknown.status_code, unknown.json()) == (allowed.status_code, allowed.json())
    assert sorted(unknown.headers) == sorted(allowed.headers)
    assert [mail.to for mail in site.mailer.sent] == [EMAIL]
    # The same one call ran: a link row exists, marked unusable, and counters are kept.
    rows = site.su.execute("SELECT email, usable FROM player.login_links ORDER BY email").fetchall()
    assert rows == [(EMAIL, True), ("stranger@example.test", False)]
    assert site.su.execute("SELECT count(*) FROM player.accounts").fetchone() == (0,)
    assert site.su.execute("SELECT count(*) FROM player.audit_events").fetchone() == (0,)


def test_an_address_taken_off_the_allowlist_cannot_finish_a_first_sign_in(site: Site) -> None:
    site.allow(EMAIL)
    token = site.ask(site.first, EMAIL)
    site.su.execute("DELETE FROM player.signup_allowlist")
    assert site.first.post(COMPLETE, json={"token": token}).status_code == 401
    assert site.su.execute("SELECT count(*) FROM player.accounts").fetchone() == (0,)


def test_an_account_signs_in_without_being_on_the_allowlist(site: Site) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)
    site.su.execute("DELETE FROM player.signup_allowlist")
    site.sign_in(EMAIL, site.browser())


def test_a_valid_browser_token_is_reused(site: Site) -> None:
    site.allow(EMAIL)
    site.ask(site.first, EMAIL)
    token = site.first.cookies.get(LOGIN_COOKIE)
    again = site.first.post(LINK, json={"email": EMAIL})
    assert again.headers.get_list("set-cookie") == []
    assert site.first.cookies.get(LOGIN_COOKIE) == token


def test_what_is_not_a_link_token_is_refused_by_its_shape(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    session = browser.cookies.get(SESSION_COOKIE)
    assert session is not None

    def never(*args: object, **kwargs: object) -> bool:
        raise AssertionError("a lookup was made")

    # Refused by its prefix and shape, before any lookup (principle 2).
    monkeypatch.setattr(login, "complete", never)
    for value in ("", "x", session, session.replace("_ses_", "_ml_") + "A"):
        refused = site.first.post(COMPLETE, json={"token": value})
        assert refused.status_code == 401 and refused.json() == {"error": "sign_in_refused"}


def test_bad_input_is_answered_without_repeating_it(site: Site) -> None:
    for body in ({"email": "not an address"}, {"email": "@example.test"}, {"email": "a@"}):
        refused = site.browser().post(LINK, json=body)
        assert refused.status_code == 422 and refused.json() == {"error": "invalid_email"}
    wrong: list[tuple[str, object]] = [
        (LINK, {"mail": "x@example.test"}),
        (LINK, {"email": "x" * 1001}),
        (COMPLETE, {"token": 7}),
        (COMPLETE, ["x"]),
    ]
    for path, body in wrong:
        refused = site.first.post(path, json=body)
        assert refused.status_code == 422 and refused.json() == {"error": "invalid_request"}
    assert site.mailer.sent == []
