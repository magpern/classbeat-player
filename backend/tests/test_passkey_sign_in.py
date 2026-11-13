"""Passkey sign-in through the site's API (ADR 0002, sections 4, 10 and 11), with a software
authenticator: the challenge, its browser, its single use, origin and RP ID, the counter rule,
another account's credential, user verification and the events."""

from __future__ import annotations

import base64
import time

import pytest

from tests.passkeyhelp import (
    SIGN_IN,
    SIGN_IN_OPTIONS,
    Authenticator,
    options_of,
    register,
    sign_in,
    unb64,
)
from tests.sitehelp import LOGIN_COOKIE, SESSION_COOKIE, Browser, Site

A = "a@example.test"
B = "b@example.test"
REFUSED = {"error": "sign_in_refused"}


@pytest.fixture(autouse=True)
def _away_from_a_window_edge() -> None:  # pyright: ignore[reportUnusedFunction]
    """The limit's windows are fixed, 10 minutes long: do not let one end mid-test."""
    left = 600 - time.time() % 600
    if left < 5:
        time.sleep(left + 0.1)


def _with_passkey(site: Site, email: str, authenticator: Authenticator) -> Browser:
    site.allow(email)
    browser = site.sign_in(email)
    assert register(browser, authenticator).status_code == 201
    return browser


def _passkey_row(site: Site, authenticator: Authenticator) -> tuple[object, ...]:
    row = site.su.execute(
        "SELECT sign_count, last_used_at IS NOT NULL FROM player.passkeys WHERE credential_id = %s",
        (authenticator.credential_id,),
    ).fetchone()
    assert row is not None
    return tuple(row)


def _passkey_events(site: Site, email: str) -> list[tuple[str, object]]:
    return [e for e in site.events(email) if not e[0].startswith(("login.link", "passkey.added"))]


def _signed_in_events(site: Site, email: str) -> int:
    return sum(
        1
        for event, detail in site.events(email)
        if event == "login.signed_in" and isinstance(detail, dict) and detail["method"] == "passkey"
    )


def test_the_options_name_no_credential_and_need_user_verification(site: Site) -> None:
    browser = site.browser()
    options = options_of(browser.post(SIGN_IN_OPTIONS))
    assert options["rpId"] == "player.test"
    assert options["userVerification"] == "required"
    assert options.get("allowCredentials", []) == []
    assert len(unb64(str(options["challenge"]))) == 32
    assert options["timeout"] == 300000
    login = browser.cookies.get(LOGIN_COOKIE)
    assert login is not None
    # A valid browser token is reused; each start makes a new challenge.
    again = options_of(browser.post(SIGN_IN_OPTIONS))
    assert browser.cookies.get(LOGIN_COOKIE) == login
    assert again["challenge"] != options["challenge"]


def test_a_passkey_signs_in_with_a_new_session_and_its_event(site: Site) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    browser = site.browser("198.51.100.4")
    answer = sign_in(browser, authenticator)
    assert answer.status_code == 200 and answer.json() == {"status": "signed_in"}
    assert browser.cookies.get(SESSION_COOKIE) is not None
    assert browser.get("/api/site/sessions").status_code == 200
    assert _passkey_row(site, authenticator) == (1, True)
    assert _signed_in_events(site, A) == 1
    # The sign-in is recent: the new session may add a passkey at once.
    assert register(browser, Authenticator("EdDSA"), "Phone").status_code == 201


def test_a_replayed_challenge_is_refused_with_its_event(site: Site) -> None:
    # A passkey that keeps no counter: only the challenge stands against a replay.
    authenticator = Authenticator(step=0)
    _with_passkey(site, A, authenticator)
    browser = site.browser()
    credential = authenticator.get(options_of(browser.post(SIGN_IN_OPTIONS)))
    assert browser.post(SIGN_IN, json={"credential": credential}).status_code == 200
    replayed = browser.post(SIGN_IN, json={"credential": credential})
    assert replayed.status_code == 401 and replayed.json() == REFUSED
    assert _passkey_events(site, A)[-1] == (
        "login.refused",
        {"method": "passkey", "reason": "unknown_challenge"},
    )


def test_a_newer_challenge_replaces_the_browsers_older_one(site: Site) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    browser = site.browser()
    older = authenticator.get(options_of(browser.post(SIGN_IN_OPTIONS)))
    newer = authenticator.get(options_of(browser.post(SIGN_IN_OPTIONS)))
    assert browser.post(SIGN_IN, json={"credential": older}).status_code == 401
    assert browser.post(SIGN_IN, json={"credential": newer}).status_code == 200


def test_a_challenge_works_only_in_the_browser_that_asked(site: Site) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    asked, other = site.browser(), site.browser()
    other.post(SIGN_IN_OPTIONS)  # a browser token of its own
    credential = authenticator.get(options_of(asked.post(SIGN_IN_OPTIONS)))
    answer = other.post(SIGN_IN, json={"credential": credential})
    assert answer.status_code == 401 and answer.json() == REFUSED
    assert other.cookies.get(SESSION_COOKIE) is None
    assert _passkey_events(site, A)[-1] == (
        "login.refused",
        {"method": "passkey", "reason": "other_browser"},
    )
    # The challenge is used up by the refusal: the browser that asked cannot use it either.
    assert asked.post(SIGN_IN, json={"credential": credential}).status_code == 401


def test_a_browser_without_its_token_signs_nobody_in(site: Site) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    asked = site.browser()
    credential = authenticator.get(options_of(asked.post(SIGN_IN_OPTIONS)))
    bare = site.browser()
    assert bare.post(SIGN_IN, json={"credential": credential}).status_code == 401
    assert bare.cookies.get(SESSION_COOKIE) is None


def test_an_expired_challenge_is_refused(site: Site) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    browser = site.browser()
    credential = authenticator.get(options_of(browser.post(SIGN_IN_OPTIONS)))
    site.su.execute("UPDATE player.login_challenges SET expires_at = now() - interval '1 second'")
    assert browser.post(SIGN_IN, json={"credential": credential}).status_code == 401
    assert _passkey_events(site, A)[-1] == (
        "login.refused",
        {"method": "passkey", "reason": "expired"},
    )


@pytest.mark.parametrize(
    "answer",
    [
        {"origin": "https://evil.test"},
        {"origin": "https://player.test:8443"},
        {"origin": "http://player.test"},
        {"rp_id": "evil.test"},
        {"rp_id": "sub.player.test"},
        {"verified": False},
    ],
)
def test_a_wrong_origin_rp_id_or_unverified_user_is_refused_without_an_event(
    site: Site, answer: dict[str, object]
) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    before = site.events(A)
    browser = site.browser()
    refused = sign_in(browser, authenticator, **answer)
    assert refused.status_code == 401 and refused.json() == REFUSED
    assert browser.cookies.get(SESSION_COOKIE) is None
    # The signature check failed in the backend: no account is set, so no event (section 11).
    assert site.events(A) == before
    assert _passkey_row(site, authenticator) == (0, False)


def test_a_credential_of_another_account_signs_into_neither(site: Site) -> None:
    mine, theirs = Authenticator(), Authenticator()
    _with_passkey(site, A, mine)
    _with_passkey(site, B, theirs)
    before = (site.events(A), site.events(B))
    browser = site.browser()
    # A's authenticator signs, naming B's credential: B's key does not check A's signature.
    forged = sign_in(browser, mine, credential_id=theirs.credential_id)
    assert forged.status_code == 401 and forged.json() == REFUSED
    assert (site.events(A), site.events(B)) == before
    assert _passkey_row(site, theirs) == (0, False)
    # Each passkey signs in to its own account only.
    for authenticator, email in ((mine, A), (theirs, B)):
        browser = site.browser()
        assert sign_in(browser, authenticator).status_code == 200
        listed = browser.get("/api/site/passkeys").json()["passkeys"]
        assert len(listed) == 1
        assert _signed_in_events(site, email) == 1


def test_an_unknown_credential_is_refused_without_an_event(site: Site) -> None:
    _with_passkey(site, A, Authenticator())
    before = site.events(A)
    assert sign_in(site.browser(), Authenticator()).status_code == 401
    assert site.events(A) == before


def test_a_counter_that_goes_backwards_is_refused_with_its_event(site: Site) -> None:
    authenticator = Authenticator(step=1)
    _with_passkey(site, A, authenticator)
    assert sign_in(site.browser(), authenticator, counter=5).status_code == 200
    for counter in (5, 4, 0):
        refused = sign_in(site.browser(), authenticator, counter=counter)
        assert refused.status_code == 401 and refused.json() == REFUSED
        assert _passkey_events(site, A)[-1] == (
            "passkey.counter_refused",
            {"stored": 5, "received": counter},
        )
    assert _passkey_row(site, authenticator) == (5, True)
    assert sign_in(site.browser(), authenticator, counter=6).status_code == 200
    assert _passkey_row(site, authenticator) == (6, True)


def test_a_passkey_that_keeps_no_counter_signs_in_again(site: Site) -> None:
    authenticator = Authenticator(step=0)
    _with_passkey(site, A, authenticator)
    for _ in range(3):
        assert sign_in(site.browser(), authenticator).status_code == 200
    assert _passkey_row(site, authenticator) == (0, True)


def test_ten_failed_sign_ins_per_address_then_429(site: Site) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    before = site.events(A)
    browser = site.browser("198.51.100.9")
    for _ in range(10):
        assert sign_in(browser, authenticator, rp_id="evil.test").status_code == 401
    # Over the limit even a passkey that checks out is not looked at.
    limited = sign_in(browser, authenticator)
    assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    assert 1 <= int(limited.headers["Retry-After"]) <= 600
    assert browser.cookies.get(SESSION_COOKIE) is None
    assert _passkey_row(site, authenticator) == (0, False)
    # The failures wrote no event; other addresses keep working.
    assert site.events(A) == before
    assert sign_in(site.browser("198.51.100.10"), authenticator).status_code == 200


def test_sign_ins_that_succeed_are_not_counted(site: Site) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    browser = site.browser("198.51.100.11")
    for _ in range(12):
        assert sign_in(browser, authenticator).status_code == 200


def test_every_kind_of_refusal_counts_toward_the_limit(site: Site) -> None:
    authenticator = Authenticator(step=0)
    _with_passkey(site, A, authenticator)
    browser = site.browser("198.51.100.12")
    used = authenticator.get(options_of(browser.post(SIGN_IN_OPTIONS)))
    assert browser.post(SIGN_IN, json={"credential": used}).status_code == 200
    junk = {**used, "rawId": base64.urlsafe_b64encode(b"short").decode()}
    attempts: list[dict[str, object]] = [used, junk]  # a replay; a credential id of 5 bytes
    attempts += [authenticator.get(options_of(browser.post(SIGN_IN_OPTIONS)), verified=False)]
    attempts += [Authenticator().get(options_of(browser.post(SIGN_IN_OPTIONS)))]  # unknown
    for n in range(10):
        answer = browser.post(SIGN_IN, json={"credential": attempts[n % len(attempts)]})
        assert answer.status_code == 401
    assert sign_in(browser, authenticator).status_code == 429


def test_a_body_of_the_wrong_shape_is_refused_and_counts_nothing(site: Site) -> None:
    authenticator = Authenticator()
    _with_passkey(site, A, authenticator)
    browser = site.browser("198.51.100.13")
    for body in ({}, {"credential": 5}, {"credential": {"id": "x"}}):
        for _ in range(4):
            answer = browser.post(SIGN_IN, json=body)
            assert answer.status_code == 422 and answer.json() == {"error": "invalid_request"}
    assert sign_in(browser, authenticator).status_code == 200
