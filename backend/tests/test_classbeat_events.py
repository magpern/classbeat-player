"""`POST /api/classbeat/events` through the real app (ADR 0010, section 8; #496): what is refused
and with which status, a `jti` used once, the limit, and nothing of the token in a log line.

classbeat is the fake of tests/classbeathelp.py: its keys are made here and nothing is fetched or
sent over a network. What each event does to an account is in test_classbeat_event_effects.py.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import time
from collections.abc import Iterator

import httpx
import pytest

from player_backend.classbeat_event_policy import jti_hash, limit_key
from player_backend.client_policy import address_hash
from player_backend.logging_setup import configure_logging
from tests.classbeathelp import (
    ACCOUNT_DELETED,
    BACKCHANNEL,
    CLIENT_ID,
    EVENTS,
    FORM,
    ISSUER,
    SESSIONS_REVOKED,
    FakeClassbeat,
    SigningKey,
    client,
    event_body,
    event_claims,
    event_header,
    event_token,
)
from tests.dbhelp import every_value
from tests.sitehelp import SESSION_COOKIE, Browser, Site, running_site

SERVER_ADDRESS = "192.0.2.80"
SUBJECT = "pairwise-subject-1"
EMAIL = "ann@example.test"


@pytest.fixture
def fake() -> FakeClassbeat:
    return FakeClassbeat()


@pytest.fixture
def site(app_url: str, db_url: str, fake: FakeClassbeat) -> Iterator[Site]:
    with running_site(app_url, db_url, classbeat=client(fake)) as running:
        yield running


def _server(site: Site, address: str = SERVER_ADDRESS) -> Browser:
    """classbeat's server: no `Origin`, no `Sec-Fetch-*`, no cookie."""
    return site.browser(address, headers={"User-Agent": "classbeat-events/1"})


def _post(server: Browser, token: str, headers: dict[str, str] | None = None) -> httpx.Response:
    return server.post(EVENTS, content=event_body(token).encode(), headers=headers or FORM)


def _now() -> int:
    return int(time.time())


def _instructor(site: Site, email: str = EMAIL, subject: str = SUBJECT) -> Browser:
    """A signed-in instructor of `subject` (signed in by the email link, then linked)."""
    site.allow(email)
    browser = site.sign_in(email)
    site.su.execute(
        "UPDATE player.accounts SET kind = 'instructor', classbeat_issuer = %s, "
        "classbeat_subject = %s WHERE email = %s",
        (ISSUER, subject, email),
    )
    return browser


def _counts(site: Site) -> tuple[object, ...]:
    row = site.su.execute(
        "SELECT (SELECT count(*) FROM player.accounts), (SELECT count(*) FROM player.sessions),"
        " (SELECT count(*) FROM player.audit_events),"
        " (SELECT count(*) FROM player.classbeat_event_ids)"
    ).fetchone()
    assert row is not None
    return tuple(row)


def _signed(fake: FakeClassbeat, changes: dict[str, object], head: dict[str, object]) -> str:
    body = event_claims(SESSIONS_REVOKED, _now(), SUBJECT)
    for name, value in changes.items():
        if value is None:
            body.pop(name, None)
        else:
            body[name] = value
    return fake.key.sign(head, body)


REFUSED_CLAIMS: list[tuple[dict[str, object], dict[str, object]]] = [
    ({"iss": "https://other.test"}, {}),
    ({"aud": "another-client"}, {}),
    ({"aud": [CLIENT_ID, "x"]}, {}),
    ({"iat": int(time.time()) - 400}, {}),
    ({"exp": None}, {}),
    ({"exp": int(time.time()) - 120}, {}),
    ({"nonce": "n" * 43}, {}),
    ({"jti": None}, {}),
    ({"sub": None}, {}),
    ({"events": {BACKCHANNEL: {}, SESSIONS_REVOKED: {}, "urn:x": {}}}, {}),
    ({"events": {BACKCHANNEL: {}, SESSIONS_REVOKED: {}, ACCOUNT_DELETED: {}}}, {}),
    ({"events": {BACKCHANNEL: {}}}, {}),
    ({}, {"typ": "JWT"}),
    ({}, {"alg": "HS256"}),
]


@pytest.mark.parametrize(("changes", "head"), REFUSED_CLAIMS)
def test_each_refused_check_answers_400_bad_event_and_changes_nothing(
    site: Site, fake: FakeClassbeat, changes: dict[str, object], head: dict[str, object]
) -> None:
    _instructor(site)
    before = _counts(site)
    token = _signed(fake, changes, {**event_header(), **head})
    answer = _post(_server(site), token)
    assert (answer.status_code, answer.json()) == (400, {"error": "bad_event"})
    assert _counts(site) == before


def test_a_bad_signature_answers_400_bad_event(site: Site) -> None:
    _instructor(site)
    before = _counts(site)
    forged = event_token(SigningKey(), SESSIONS_REVOKED, _now(), SUBJECT)
    answer = _post(_server(site), forged)
    assert (answer.status_code, answer.json()) == (400, {"error": "bad_event"})
    assert _counts(site) == before


@pytest.mark.parametrize(
    "body",
    [b"", b"logout_token=", b"token=a.b.c", b"logout_token=a.b.c&logout_token=a.b.c", b"x=1"],
)
def test_a_body_without_one_logout_token_answers_400_bad_event(site: Site, body: bytes) -> None:
    answer = _server(site).post(EVENTS, content=body, headers=FORM)
    assert (answer.status_code, answer.json()) == (400, {"error": "bad_event"})


def test_a_body_not_sent_as_a_form_is_refused(site: Site, fake: FakeClassbeat) -> None:
    token = event_token(fake.key, SESSIONS_REVOKED, _now(), SUBJECT)
    answer = _server(site).post(EVENTS, json={"logout_token": token})
    assert (answer.status_code, answer.json()) == (415, {"error": "unsupported_media_type"})


@pytest.mark.parametrize("value", ["cross-site", "same-origin", "same-site", "none"])
def test_a_request_with_sec_fetch_site_answers_403_and_changes_nothing(
    site: Site, fake: FakeClassbeat, value: str
) -> None:
    _instructor(site)
    limits = "SELECT coalesce(sum(hits), 0) FROM player.rate_limits"
    before, counted = _counts(site), site.su.execute(limits).fetchone()
    token = event_token(fake.key, SESSIONS_REVOKED, _now(), SUBJECT)
    answer = _post(_server(site), token, {**FORM, "Sec-Fetch-Site": value})
    assert (answer.status_code, answer.json()) == (403, {"error": "cross_site_request"})
    assert _counts(site) == before
    # Refused before the body is read or anything is counted.
    assert site.su.execute(limits).fetchone() == counted


def test_a_cookie_on_the_request_is_ignored_and_grants_nothing(
    site: Site, fake: FakeClassbeat
) -> None:
    browser = _instructor(site)
    server = _server(site)
    server.take_cookies(browser)
    assert server.cookies.get(SESSION_COOKIE) is not None
    before = _counts(site)
    # A refused token is refused with the instructor's own session cookie beside it.
    forged = event_token(SigningKey(), SESSIONS_REVOKED, _now(), SUBJECT)
    assert _post(server, forged).status_code == 400
    assert _counts(site) == before
    # The site's session-taking routes are not reached through this one.
    assert browser.get("/api/site/me").status_code == 200


def test_an_accepted_event_answers_200_with_an_empty_body(site: Site, fake: FakeClassbeat) -> None:
    _instructor(site)
    answer = _post(_server(site), event_token(fake.key, SESSIONS_REVOKED, _now(), SUBJECT))
    assert (answer.status_code, answer.content) == (200, b"")


def test_a_repeated_jti_answers_200_and_changes_nothing(site: Site, fake: FakeClassbeat) -> None:
    _instructor(site)
    server = _server(site)
    assert _post(server, event_token(fake.key, SESSIONS_REVOKED, _now(), SUBJECT, "e-1")).is_success
    # Signed afresh with the same `jti`, as classbeat's retries are: nothing more happens, even
    # for the other event and after the instructor signs in again.
    browser = site.sign_in(EMAIL)
    before = _counts(site)
    for event in (SESSIONS_REVOKED, ACCOUNT_DELETED):
        answer = _post(server, event_token(fake.key, event, _now(), SUBJECT, "e-1"))
        assert (answer.status_code, answer.content) == (200, b"")
    assert _counts(site) == before
    assert browser.get("/api/site/me").status_code == 200


def test_a_subject_with_no_account_answers_200_and_changes_nothing(
    site: Site, fake: FakeClassbeat
) -> None:
    _instructor(site)
    before_accounts = site.su.execute("SELECT count(*) FROM player.accounts").fetchone()
    for event in (SESSIONS_REVOKED, ACCOUNT_DELETED):
        answer = _post(_server(site), event_token(fake.key, event, _now(), "nobody-here"))
        assert (answer.status_code, answer.content) == (200, b"")
    assert site.su.execute("SELECT count(*) FROM player.accounts").fetchone() == before_accounts
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)


def test_an_unlinked_account_with_the_same_subject_is_not_found(
    site: Site, fake: FakeClassbeat
) -> None:
    # Only an instructor has an identity; an email account is never matched.
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    answer = _post(_server(site), event_token(fake.key, ACCOUNT_DELETED, _now(), SUBJECT))
    assert answer.status_code == 200
    assert browser.get("/api/site/me").status_code == 200


def test_the_jti_is_kept_as_a_hash_for_8_days(site: Site, fake: FakeClassbeat) -> None:
    _instructor(site)
    assert _post(_server(site), event_token(fake.key, SESSIONS_REVOKED, _now(), SUBJECT, "e-9"))
    row = site.su.execute(
        "SELECT jti_hash, extract(epoch FROM expires_at - now())::float8 "
        "FROM player.classbeat_event_ids"
    ).fetchone()
    assert row is not None
    kept, seconds = row
    assert isinstance(kept, bytes) and isinstance(seconds, float)
    assert kept == jti_hash("e-9")
    assert 8 * 86400 - 60 < seconds <= 8 * 86400


def test_the_purge_removes_ids_older_than_8_days_and_keeps_the_rest(site: Site) -> None:
    old, fresh = jti_hash("old"), jti_hash("fresh")
    site.su.execute(
        "INSERT INTO player.classbeat_event_ids (jti_hash, expires_at) VALUES "
        "(%s, now() - interval '1 second'), (%s, now() + interval '8 days')",
        (old, fresh),
    )
    site.su.execute("SELECT player.auth_purge_expired()")
    kept = site.su.execute("SELECT jti_hash FROM player.classbeat_event_ids").fetchall()
    assert kept == [(fresh,)]


def test_events_over_600_a_minute_from_one_address_answer_429(
    site: Site, fake: FakeClassbeat
) -> None:
    _instructor(site)
    key = limit_key(address_hash(ipaddress.ip_address(SERVER_ADDRESS)))
    site.su.execute(
        "SELECT player.rate_limit_hit(%s, interval '1 minute', 600) FROM generate_series(1, 600)",
        (key,),
    )
    before = _counts(site)
    answer = _post(_server(site), event_token(fake.key, SESSIONS_REVOKED, _now(), SUBJECT))
    assert (answer.status_code, answer.json()) == (429, {"error": "too_many_requests"})
    assert answer.headers["retry-after"] == "60"
    assert _counts(site) == before
    # Another address is not held back.
    other = _server(site, "192.0.2.81")
    assert _post(other, event_token(fake.key, SESSIONS_REVOKED, _now(), SUBJECT)).is_success


def test_without_classbeat_the_route_answers_404(app_url: str, db_url: str) -> None:
    with running_site(app_url, db_url) as plain:
        token = event_token(SigningKey(), SESSIONS_REVOKED, _now(), SUBJECT)
        answer = _post(_server(plain), token)
        assert (answer.status_code, answer.json()) == (404, {"error": "not_found"})


def test_no_token_subject_or_jti_is_logged_or_stored(
    site: Site,
    fake: FakeClassbeat,
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    subject, jti = "pairwise-secret-subject", "event-secret-jti-1"
    _instructor(site, subject=subject)
    server = _server(site)
    tokens = [
        event_token(fake.key, SESSIONS_REVOKED, _now(), subject, jti),
        event_token(fake.key, SESSIONS_REVOKED, _now(), subject, jti),
        event_token(SigningKey(), ACCOUNT_DELETED, _now(), subject, "event-secret-jti-2"),
        _signed(fake, {"sub": subject, "jti": "event-secret-jti-3", "nonce": "x"}, event_header()),
    ]
    for token in tokens:
        _post(server, token)
    captured = capsys.readouterr()
    ours = [r for r in caplog.records if not r.name.startswith(("httpx", "httpcore"))]
    lines = [
        line
        for line in (captured.out + captured.err).splitlines()
        if not (line.startswith("{") and json.loads(line).get("logger", "").startswith("httpx"))
    ]
    logged = "\n".join(lines + [r.getMessage() + str(r.__dict__) for r in ours])
    assert lines
    for secret in [*tokens, jti, "event-secret-jti-2", "event-secret-jti-3"]:
        assert secret not in logged
        assert secret not in every_value(site.su)
    assert subject not in logged
    # The subject stays where it was (the account's identity), and in no event.
    events = site.su.execute("SELECT row_to_json(e)::text FROM player.audit_events e").fetchall()
    assert events and all(subject not in str(event) and jti not in str(event) for event in events)
