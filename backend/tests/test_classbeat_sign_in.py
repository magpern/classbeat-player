"""Sign in with classbeat through the site's API (ADR 0010, sections 2, 4, 5 and 6; #481).

The real app on the test database; classbeat is the fake of tests/classbeathelp.py, with a
signing key made here. No network.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import LiteralString
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from player_backend.logging_setup import configure_logging
from player_backend.token_policy import token_hash
from tests.classbeathelp import ISSUER, FakeClassbeat, client
from tests.dbhelp import every_value
from tests.sitehelp import SESSION_COOKIE, Browser, Site, running_site

BINDING_COOKIE = "__Host-cbp_cbsign"
START = "/api/site/sign-in/classbeat/start"
CALLBACK = "/api/site/sign-in/classbeat/callback"
ERROR = "/sign-in#error=classbeat"
# What a browser sends on the navigation back from classbeat.
NAVIGATION = {
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Site": "cross-site",
}
EMAIL = "ann@example.test"
SUBJECT = "pairwise-subject-1"


@pytest.fixture
def fake() -> FakeClassbeat:
    return FakeClassbeat(user={"sub": SUBJECT, "email": EMAIL, "email_verified": True})


@pytest.fixture
def site(app_url: str, db_url: str, fake: FakeClassbeat) -> Iterator[Site]:
    with running_site(app_url, db_url, classbeat=client(fake)) as running:
        yield running


def start(browser: Browser, purpose: str = "sign_in") -> str:
    response = browser.post(START, json={"purpose": purpose})
    assert response.status_code == 200, response.text
    assert browser.cookies.get(BINDING_COOKIE) is not None
    address = response.json()["authorize"]
    assert isinstance(address, str)
    return address


def back(browser: Browser, callback: str) -> httpx.Response:
    return browser.get(callback, headers=NAVIGATION)


def sign_in(site: Site, fake: FakeClassbeat, browser: Browser | None = None) -> Browser:
    browser = browser or site.browser()
    answer = back(browser, fake.authorize(start(browser)))
    assert answer.status_code == 303 and answer.headers["location"] == "/classes"
    return browser


def _count(site: Site, statement: LiteralString) -> int:
    row = site.su.execute(statement).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


def _accounts(site: Site) -> list[tuple[object, ...]]:
    return site.su.execute(
        "SELECT id, kind, classbeat_issuer, classbeat_subject, email FROM player.accounts"
    ).fetchall()


def _written(site: Site) -> tuple[int, int, int]:
    return (
        _count(site, "SELECT count(*) FROM player.accounts"),
        _count(site, "SELECT count(*) FROM player.sessions"),
        _count(site, "SELECT count(*) FROM player.audit_events"),
    )


# --- criterion 1: sign-up, then sign-in by identity ------------------------------------------


def test_a_first_sign_in_creates_the_instructor_and_later_ones_find_it_by_identity(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    browser = sign_in(site, fake)
    [(account, kind, issuer, subject, email)] = _accounts(site)
    assert (kind, issuer, subject, email) == ("instructor", ISSUER, SUBJECT, EMAIL)
    assert browser.cookies.get(BINDING_COOKIE) is None
    me = browser.get("/api/site/me")
    assert me.status_code == 200 and me.json() == {"email": EMAIL}

    # classbeat's email changes: the same account, its display email follows.
    fake.user = {"sub": SUBJECT, "email": "ann.new@example.test", "email_verified": True}
    sign_in(site, fake, site.browser("198.51.100.4"))
    [(again, _, _, _, email)] = _accounts(site)
    assert again == account and email == "ann.new@example.test"
    # And the old email entry lets no other identity in.
    fake.user = {"sub": "pairwise-other", "email": EMAIL, "email_verified": True}
    other = site.browser("198.51.100.5")
    answer = back(other, fake.authorize(start(other)))
    assert answer.headers["location"] == ERROR and len(_accounts(site)) == 1


# --- section 6 (as revised): no return entry ---------------------------------------------


@pytest.mark.parametrize(
    "return_to",
    # `null`, valid entries, malformed strings, and values that are not strings.
    [None, "control", "control.BCDF-GHJK", "play", "https://evil.test", "", 1, ["play"], {}],
)
@pytest.mark.parametrize("purpose", ["sign_in", "reauth"])
def test_a_start_carrying_a_return_entry_is_refused_and_makes_nothing(
    site: Site,
    fake: FakeClassbeat,
    capsys: pytest.CaptureFixture[str],
    purpose: str,
    return_to: object,
) -> None:
    site.allow(EMAIL)
    browser = sign_in(site, fake) if purpose == "reauth" else site.browser()
    held = start(browser)  # an earlier flow of this browser, which the refusal leaves alone
    binding = browser.cookies.get(BINDING_COOKIE)
    events = _count(site, "SELECT count(*) FROM player.audit_events")
    configure_logging("DEBUG")
    capsys.readouterr()
    response = browser.post(START, json={"purpose": purpose, "return_to": return_to})
    assert response.status_code == 422 and response.json() == {"error": "invalid_return"}
    assert "set-cookie" not in response.headers
    assert browser.cookies.get(BINDING_COOKIE) == binding
    assert _count(site, "SELECT count(*) FROM player.classbeat_sign_ins") == 1
    assert _count(site, "SELECT count(*) FROM player.audit_events") == events
    logged = capsys.readouterr()
    if isinstance(return_to, str) and return_to:
        assert return_to not in every_value(site.su)
    # Not in a log line: the parts that are not words of every line ("play" is in "player").
    for needle in ("BCDF-GHJK", "evil.test"):
        if needle in str(return_to):
            assert needle not in logged.out + logged.err
    # The earlier flow still completes, and lands on the classes page.
    answer = back(browser, fake.authorize(held))
    assert answer.status_code == 303 and answer.headers["location"] == "/classes"


def test_a_refused_start_is_counted_by_the_limit_first(site: Site) -> None:
    browser = site.browser()
    for _ in range(20):
        refused = browser.post(START, json={"return_to": "play"})
        assert refused.status_code == 422 and refused.json() == {"error": "invalid_return"}
    over = browser.post(START, json={"return_to": "play"})
    assert over.status_code == 429 and over.json() == {"error": "too_many_requests"}
    assert browser.post(START, json={}).status_code == 429
    assert _count(site, "SELECT count(*) FROM player.classbeat_sign_ins") == 0


def test_a_re_authentication_start_checks_the_session_before_the_entry(site: Site) -> None:
    response = site.browser().post(START, json={"purpose": "reauth", "return_to": None})
    assert response.status_code == 401 and response.json() == {"error": "not_signed_in"}


@pytest.mark.parametrize("purpose", ["sign_in", "reauth"])
def test_every_callback_that_signs_in_lands_on_the_classes_page(
    site: Site, fake: FakeClassbeat, purpose: str
) -> None:
    site.allow(EMAIL)
    browser = sign_in(site, fake) if purpose == "reauth" else site.browser()
    answer = back(browser, fake.authorize(start(browser, purpose)))
    assert answer.status_code == 303 and answer.headers["location"] == "/classes"
    assert "#" not in answer.headers["location"]


def test_the_start_asks_for_openid_email_with_pkce_and_no_prompt(
    site: Site, fake: FakeClassbeat
) -> None:
    browser = site.browser()
    query = parse_qs(urlsplit(start(browser)).query)
    assert query["scope"] == ["openid email"] and query["code_challenge_method"] == ["S256"]
    assert "prompt" not in query
    response = browser.post(START, json={"purpose": "sign_in"})
    assert "binding" not in response.text and BINDING_COOKIE not in response.text


def test_the_token_call_sends_the_binding_token_as_the_verifier(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    browser = site.browser()
    address = start(browser)
    binding = browser.cookies.get(BINDING_COOKIE)
    back(browser, fake.authorize(address))
    [form] = fake.forms
    assert form["code_verifier"] == binding and form["grant_type"] == "authorization_code"
    assert form["redirect_uri"].endswith(CALLBACK)


def test_a_start_from_another_origin_is_refused(site: Site) -> None:
    browser = site.browser(headers={"Origin": "https://evil.test"})
    assert browser.post(START, json={}).status_code == 403


# --- criterion 3: the callback's refusals -----------------------------------------------------


def _refused(answer: httpx.Response) -> None:
    assert answer.status_code == 303 and answer.headers["location"] == ERROR
    assert "set-cookie" not in answer.headers or SESSION_COOKIE not in answer.headers["set-cookie"]


def test_a_callback_without_the_binding_cookie_is_refused(site: Site, fake: FakeClassbeat) -> None:
    site.allow(EMAIL)
    callback = fake.authorize(start(site.browser()))
    before = _written(site)
    _refused(back(site.browser("198.51.100.9"), callback))
    assert _written(site) == before == (0, 0, 0)


def test_a_callback_with_another_browsers_cookie_is_refused(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    victim, attacker = site.browser(), site.browser("198.51.100.9")
    start(victim)
    attackers_callback = fake.authorize(start(attacker))
    _refused(back(victim, attackers_callback))
    assert _written(site) == (0, 0, 0)
    assert fake.forms == []


def test_a_replayed_callback_is_refused(site: Site, fake: FakeClassbeat) -> None:
    site.allow(EMAIL)
    browser = site.browser()
    callback = fake.authorize(start(browser))
    binding = browser.cookies.get(BINDING_COOKIE)
    assert back(browser, callback).headers["location"] == "/classes"
    written = _written(site)
    assert binding is not None
    browser.cookies.set(BINDING_COOKIE, binding, domain="player.test")
    _refused(back(browser, callback))
    assert _written(site) == written


def test_a_callback_after_600_seconds_is_refused(site: Site, fake: FakeClassbeat) -> None:
    site.allow(EMAIL)
    browser = site.browser()
    callback = fake.authorize(start(browser))
    site.su.execute("UPDATE player.classbeat_sign_ins SET expires_at = now() - interval '1 second'")
    _refused(back(browser, callback))
    assert _written(site) == (0, 0, 0)
    assert _count(site, "SELECT count(*) FROM player.classbeat_sign_ins") == 0


@pytest.mark.parametrize(
    "headers",
    [
        {"Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty"},
        {"Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image"},
        {"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe"},
        {"Sec-Fetch-Mode": "same-origin", "Sec-Fetch-Dest": "document"},
    ],
)
def test_a_callback_that_is_not_a_top_level_navigation_is_refused_and_uses_nothing_up(
    site: Site, fake: FakeClassbeat, headers: dict[str, str]
) -> None:
    site.allow(EMAIL)
    browser = site.browser()
    callback = fake.authorize(start(browser))
    _refused(browser.get(callback, headers=headers))
    assert _written(site) == (0, 0, 0)
    # The row is still there: the real navigation completes.
    assert back(browser, callback).headers["location"] == "/classes"


@pytest.mark.parametrize(
    "query",
    [
        "?error=access_denied&state=" + "s" * 43,
        "?code=abc",
        "?code=abc&state=" + "s" * 43 + "&iss=https://other.test",
        "?code=abc&state=" + "s" * 43 + "&state=" + "t" * 43,
    ],
)
def test_a_callback_with_a_wrong_query_is_refused(
    site: Site, fake: FakeClassbeat, query: str
) -> None:
    browser = site.browser()
    start(browser)
    _refused(back(browser, CALLBACK + query))
    assert _count(site, "SELECT count(*) FROM player.classbeat_sign_ins") == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"aud": "another-client"},
        {"iss": "https://other.test"},
        {"nonce": "another-nonce"},
        {"exp": 1},
        {"auth_time": "not-a-time"},
    ],
)
def test_a_token_that_fails_its_check_signs_nobody_in(
    site: Site, fake: FakeClassbeat, changes: dict[str, object]
) -> None:
    site.allow(EMAIL)
    fake.claim_changes = dict(changes)
    browser = site.browser()
    _refused(back(browser, fake.authorize(start(browser))))
    assert _written(site) == (0, 0, 0)
    assert browser.cookies.get(BINDING_COOKIE) is None


def test_an_email_that_is_not_allowed_signs_nobody_up(site: Site, fake: FakeClassbeat) -> None:
    browser = site.browser()
    _refused(back(browser, fake.authorize(start(browser))))
    assert _written(site) == (0, 0, 0)


def test_state_nonce_and_binding_are_kept_only_as_hashes(site: Site, fake: FakeClassbeat) -> None:
    browser = site.browser()
    address = start(browser)
    query = {k: v[0] for k, v in parse_qs(urlsplit(address).query).items()}
    binding = browser.cookies.get(BINDING_COOKIE)
    assert binding is not None
    stored = every_value(site.su)
    for clear in (query["state"], query["nonce"], binding, query["code_challenge"]):
        assert clear not in stored
    row = site.su.execute(
        "SELECT binding_hash, state_hash, purpose FROM player.classbeat_sign_ins"
    ).fetchone()
    assert row is not None
    assert row[0] == token_hash(binding) and row[1] == token_hash(query["state"])
    assert row[2] == "sign_in"


def test_a_new_start_in_the_same_browser_ends_its_earlier_flow(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    browser = site.browser()
    first = fake.authorize(start(browser))
    start(browser)
    assert _count(site, "SELECT count(*) FROM player.classbeat_sign_ins") == 1
    _refused(back(browser, first))


def test_starts_over_the_limit_get_429_and_no_cookie(site: Site) -> None:
    browser = site.browser()
    for _ in range(20):
        assert browser.post(START, json={}).status_code == 200
    fresh = site.browser()
    response = fresh.post(START, json={})
    assert response.status_code == 429 and "retry-after" in response.headers
    assert fresh.cookies.get(BINDING_COOKIE) is None


# --- criterion 4: re-authentication ----------------------------------------------------------


def _session_row(site: Site, browser: Browser) -> tuple[object, ...] | None:
    token = browser.cookies.get(SESSION_COOKIE)
    assert token is not None
    return site.su.execute(
        "SELECT id, signed_in_at FROM player.sessions WHERE token_hash = %s", (token_hash(token),)
    ).fetchone()


def test_a_re_authentication_renews_the_recent_sign_in_of_the_same_identity(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    browser = sign_in(site, fake)
    old = _session_row(site, browser)
    address = start(browser, purpose="reauth")
    assert parse_qs(urlsplit(address).query)["prompt"] == ["login"]
    answer = back(browser, fake.authorize(address))
    assert answer.status_code == 303 and answer.headers["location"] == "/classes"
    new = _session_row(site, browser)
    assert old is not None and new is not None and new[0] != old[0]
    assert _count(site, "SELECT count(*) FROM player.sessions") == 1
    events = [e for (e,) in site.su.execute("SELECT event FROM player.audit_events").fetchall()]
    assert "login.reauthenticated" in events and "session.signed_out" in events


def test_a_re_authentication_as_another_identity_is_refused_and_changes_no_session(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    site.allow("bo@example.test")
    browser = sign_in(site, fake)
    old = _session_row(site, browser)
    address = start(browser, purpose="reauth")
    fake.user = {"sub": "pairwise-bo", "email": "bo@example.test", "email_verified": True}
    _refused(back(browser, fake.authorize(address)))
    assert _session_row(site, browser) == old
    assert _count(site, "SELECT count(*) FROM player.accounts") == 1
    reasons = site.su.execute(
        "SELECT detail->>'reason' FROM player.audit_events WHERE event = 'reauth.refused'"
    ).fetchall()
    assert reasons == [("other_identity",)]


def test_a_re_authentication_with_a_stale_auth_time_is_refused(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    browser = sign_in(site, fake)
    old = _session_row(site, browser)
    address = start(browser, purpose="reauth")
    fake.claim_changes = {"auth_time": int(time.time()) - 3600}
    _refused(back(browser, fake.authorize(address)))
    assert _session_row(site, browser) == old


def test_a_re_authentication_callback_needs_the_asking_session(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    browser = sign_in(site, fake)
    other = sign_in(site, fake, site.browser("198.51.100.4"))
    address = start(browser, purpose="reauth")
    # The same binding cookie, but the session of another browser.
    session = other.cookies.get(SESSION_COOKIE)
    assert session is not None
    browser.cookies.set(SESSION_COOKIE, session, domain="player.test")
    _refused(back(browser, fake.authorize(address)))
    # Refused before the code is exchanged: only the two sign-ins called the token endpoint.
    assert len(fake.forms) == 2


def test_a_re_authentication_start_without_a_session_is_401(site: Site) -> None:
    response = site.browser().post(START, json={"purpose": "reauth"})
    assert response.status_code == 401 and response.json()["error"] == "not_signed_in"


def test_a_sign_in_ends_the_session_the_browser_held(site: Site, fake: FakeClassbeat) -> None:
    site.allow(EMAIL)
    browser = sign_in(site, fake)
    sign_in(site, fake, browser)
    assert _count(site, "SELECT count(*) FROM player.sessions") == 1
