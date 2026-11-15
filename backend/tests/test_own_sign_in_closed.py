"""The email link and passkeys are closed for every account kind there is today (ADR 0010,
section 7; #495), through the site's API and the functions themselves.

`auth_request_login`, `auth_complete_login`, `auth_complete_passkey` and passkey registration
(both its steps) refuse every account whose kind is not `follower`. No function makes a
follower, so in practice they refuse everything; the code behind the refusal stays tested with
a follower the tests' superuser makes (tests/test_sign_in_link.py, tests/test_passkeys.py and
the other passkey tests). classbeat is the fake of tests/classbeathelp.py. No network.
"""

from __future__ import annotations

import re
import secrets
import uuid
from collections.abc import Iterator

import httpx
import pytest
from psycopg import sql

from player_backend.own_sign_in_policy import ACCOUNT_KINDS, OWN_SIGN_IN_KINDS
from player_backend.passkey_policy import challenge_hash, registration_starts_key
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash
from tests.classbeathelp import ISSUER, FakeClassbeat, client
from tests.passkeyhelp import (
    OPTIONS,
    PASSKEYS,
    SIGN_IN,
    SIGN_IN_OPTIONS,
    Authenticator,
    b64,
    options_of,
    register,
    sign_in,
)
from tests.sitehelp import LOGIN_COOKIE, SESSION_COOKIE, Browser, Site, running_site, subject_of

EMAIL = "ann@example.test"
LINK = "/api/site/sign-in/link"
COMPLETE = "/api/site/sign-in/complete"
CLOSED_ANSWER = {"error": "passkeys_closed"}
# Every kind of account there is today: all but the reserved `follower`.
CLOSED = sorted(ACCOUNT_KINDS - OWN_SIGN_IN_KINDS)
NAVIGATION = {
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Site": "cross-site",
}


@pytest.fixture
def fake() -> FakeClassbeat:
    return FakeClassbeat(user={"sub": subject_of(EMAIL), "email": EMAIL, "email_verified": True})


@pytest.fixture
def site(app_url: str, db_url: str, fake: FakeClassbeat) -> Iterator[Site]:
    with running_site(app_url, db_url, classbeat=client(fake)) as running:
        yield running


def _account(site: Site, kind: str, email: str = EMAIL) -> uuid.UUID:
    """An account of `kind`, made by the tests' superuser; an instructor has its identity."""
    identity = (ISSUER, subject_of(email)) if kind == "instructor" else (None, None)
    row = site.su.execute(
        "INSERT INTO player.accounts "
        "(kind, email, passkey_user_handle, classbeat_issuer, classbeat_subject) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (kind, email, secrets.token_bytes(32), *identity),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _set_kind(site: Site, account: uuid.UUID, kind: str) -> None:
    identity = (ISSUER, "subject-" + str(account)) if kind == "instructor" else (None, None)
    site.su.execute(
        "UPDATE player.accounts SET kind = %s, classbeat_issuer = %s, classbeat_subject = %s "
        "WHERE id = %s",
        (kind, *identity, account),
    )


def _signed_in(site: Site, kind: str) -> tuple[Browser, uuid.UUID]:
    """A browser with a fresh session of an account of `kind`."""
    account = _account(site, kind)
    token = new_token("ses")
    site.su.execute(
        "INSERT INTO player.sessions (account_id, token_hash) VALUES (%s, %s)",
        (account, token_hash(token)),
    )
    browser = site.browser()
    browser.cookies.set(SESSION_COOKIE, token, domain="player.test")
    return browser, account


def _count(site: Site, table: str) -> int:
    row = site.su.execute(
        sql.SQL("SELECT count(*) FROM player.{}").format(sql.Identifier(table))
    ).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


def _events(site: Site, account: uuid.UUID) -> list[tuple[object, ...]]:
    return [
        tuple(row)
        for row in site.su.execute(
            "SELECT event, credential_kind, detail FROM player.audit_events "
            "WHERE account_id = %s ORDER BY occurred_at, event",
            (account,),
        ).fetchall()
    ]


# --- The kinds -------------------------------------------------------------------------------


def test_the_closed_kinds_are_every_kind_of_the_database_but_follower(site: Site) -> None:
    row = site.su.execute(
        "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
        "WHERE c.conrelid = 'player.accounts'::regclass AND c.contype = 'c' "
        "AND pg_get_constraintdef(c.oid) LIKE '%%kind = ANY%%'"
    ).fetchone()
    assert row is not None
    assert set(re.findall(r"'([a-z_]+)'::text", str(row[0]))) == ACCOUNT_KINDS
    assert OWN_SIGN_IN_KINDS == {"follower"}
    assert CLOSED == ["instructor", "unlinked"]


# --- The email link --------------------------------------------------------------------------


def _answer(browser: Browser, email: str) -> tuple[int, object, list[str], bool]:
    asked = browser.post(LINK, json={"email": email})
    return asked.status_code, asked.json(), sorted(asked.headers), LOGIN_COOKIE in asked.cookies


@pytest.mark.parametrize("kind", [*CLOSED, None])
@pytest.mark.parametrize("entry", ["none", "unbound", "bound"])
def test_a_link_request_makes_no_account_and_sends_no_mail_and_answers_as_for_nobody(
    site: Site, kind: str | None, entry: str
) -> None:
    if kind is not None:
        _account(site, kind)
    if entry != "none":
        bound = (ISSUER, subject_of(EMAIL)) if entry == "bound" else (None, None)
        site.su.execute(
            "INSERT INTO player.signup_allowlist (email, bound_issuer, bound_subject) "
            "VALUES (%s, %s, %s)",
            (EMAIL, *bound),
        )
    stranger = site.browser()
    # A first request, and one from a browser that holds its token: each as for nobody.
    nobody = [_answer(stranger, "nobody@example.test") for _ in range(2)]
    assert [n[:2] for n in nobody] == [(200, {"status": "accepted"})] * 2
    assert [n[3] for n in nobody] == [True, False]
    accounts = _count(site, "accounts")
    assert [_answer(site.first, EMAIL) for _ in range(2)] == nobody
    assert site.mailer.sent == []
    assert _count(site, "accounts") == accounts
    links = site.su.execute("SELECT DISTINCT usable FROM player.login_links").fetchall()
    assert links == [(False,)]
    # No event: the email link finds no account of these kinds (section 7).
    assert _count(site, "audit_events") == 0


@pytest.mark.parametrize("kind", [*CLOSED, "allowlisted"])
def test_a_link_made_usable_before_the_change_signs_in_to_nothing(site: Site, kind: str) -> None:
    """A usable row, as a request made before migration 0015 could leave for an unlinked or an
    allowlisted address, is refused when used, in the browser that asked."""
    if kind == "allowlisted":
        site.allow(EMAIL)
    else:
        _account(site, kind)
    link, login = new_token("ml"), new_token("lgn")
    site.su.execute(
        "INSERT INTO player.login_links (link_hash, email, browser_hash, usable, expires_at) "
        "VALUES (%s, %s, %s, true, now() + interval '15 minutes')",
        (token_hash(link), EMAIL, token_hash(login)),
    )
    accounts = _count(site, "accounts")
    browser = site.browser()
    browser.cookies.set(LOGIN_COOKIE, login, domain="player.test")
    refused = browser.post(COMPLETE, json={"token": link})
    assert refused.status_code == 401 and refused.json() == {"error": "sign_in_refused"}
    assert browser.cookies.get(SESSION_COOKIE) is None
    assert (_count(site, "accounts"), _count(site, "sessions")) == (accounts, 0)
    assert _count(site, "audit_events") == 0


# --- Passkey registration --------------------------------------------------------------------


def test_an_instructor_fresh_from_classbeat_cannot_register_a_passkey(
    site: Site, fake: FakeClassbeat
) -> None:
    site.allow(EMAIL)
    browser = site.browser()
    started = browser.post("/api/site/sign-in/classbeat/start", json={"purpose": "sign_in"})
    assert started.status_code == 200
    back = browser.get(fake.authorize(started.json()["authorize"]), headers=NAVIGATION)
    assert back.status_code == 303 and back.headers["location"] == "/classes"
    row = site.su.execute(
        "SELECT a.id, a.kind, now() - s.signed_in_at < interval '1 minute' "
        "FROM player.accounts a JOIN player.sessions s ON s.account_id = a.id"
    ).fetchone()
    assert row is not None and row[1:] == ("instructor", True)
    account = row[0]
    assert isinstance(account, uuid.UUID)
    events = _events(site, account)

    started_options = browser.post(OPTIONS)
    assert started_options.status_code == 403 and started_options.json() == CLOSED_ANSWER
    # A registration row as a start before this change made it: the finish is refused too.
    _waiting_registration(site, account)
    finished = _finish(browser, account)
    assert finished.status_code == 403 and finished.json() == CLOSED_ANSWER
    assert _count(site, "passkeys") == 0
    assert _starts_counted(site, account) == 0
    assert _events(site, account) == events and site.mailer.sent == []


CHALLENGE = secrets.token_bytes(32)


def _waiting_registration(site: Site, account: uuid.UUID) -> None:
    site.su.execute(
        "INSERT INTO player.passkey_registrations (account_id, session_id, challenge_hash, "
        "expires_at) SELECT %s, s.id, %s, now() + interval '5 minutes' FROM player.sessions s "
        "WHERE s.account_id = %s",
        (account, challenge_hash(CHALLENGE), account),
    )
    assert _count(site, "passkey_registrations") == 1


def _finish(browser: Browser, account: uuid.UUID) -> httpx.Response:
    options: dict[str, object] = {
        "challenge": b64(CHALLENGE),
        "rp": {"id": "player.test"},
        "user": {"id": b64(account.bytes * 2)},
    }
    credential = Authenticator().create(options)
    return browser.post(PASSKEYS, json={"name": "Laptop", "credential": credential})


def _starts_counted(site: Site, account: uuid.UUID) -> int:
    row = site.su.execute(
        "SELECT count(*) FROM player.rate_limits WHERE key_hash = %s",
        (registration_starts_key(account),),
    ).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


@pytest.mark.parametrize("kind", CLOSED)
def test_no_closed_kind_may_start_or_finish_a_registration(site: Site, kind: str) -> None:
    browser, account = _signed_in(site, kind)
    answer = browser.post(OPTIONS)
    assert answer.status_code == 403 and answer.json() == CLOSED_ANSWER
    _waiting_registration(site, account)
    finished = _finish(browser, account)
    assert finished.status_code == 403 and finished.json() == CLOSED_ANSWER
    # Nothing is stored, counted or used up, and no event or mail is written.
    assert _count(site, "passkeys") == 0 and _count(site, "passkey_registrations") == 1
    assert _starts_counted(site, account) == 0
    assert _events(site, account) == [] and site.mailer.sent == []
    # What an account holds already stays listable (and removable: tests/test_passkeys.py).
    assert browser.get(PASSKEYS).json() == {"passkeys": []}


# --- Passkey sign-in -------------------------------------------------------------------------


@pytest.mark.parametrize("kind", CLOSED)
def test_a_passkey_registered_before_the_change_cannot_sign_in(site: Site, kind: str) -> None:
    """Registered through the site while its account could (a follower here), then the account
    is of a closed kind, as every account was when migration 0015 ran."""
    authenticator = Authenticator()
    site.follower(EMAIL)
    assert register(site.link_sign_in(EMAIL), authenticator).status_code == 201
    assert sign_in(site.browser(), authenticator).status_code == 200
    row = site.su.execute(
        "SELECT p.id, p.account_id, p.sign_count FROM player.passkeys p"
    ).fetchone()
    assert row is not None
    passkey, account, counted = row
    assert isinstance(account, uuid.UUID) and counted == 1
    _set_kind(site, account, kind)
    site.su.execute("DELETE FROM player.sessions")
    before = len(_events(site, account))

    browser = site.browser("198.51.100.9")
    refused = sign_in(browser, authenticator)
    assert refused.status_code == 401 and refused.json() == {"error": "sign_in_refused"}
    assert browser.cookies.get(SESSION_COOKIE) is None
    assert _count(site, "sessions") == 0
    # The counter is left as it was, and the refusal is the account's event, with no more in it
    # than the other refusals of a passkey: the method and a reason.
    assert site.su.execute("SELECT sign_count FROM player.passkeys").fetchone() == (1,)
    assert _events(site, account)[before:] == [
        ("login.refused", "passkey", {"method": "passkey", "reason": "closed"})
    ]
    event = site.su.execute(
        "SELECT credential_id FROM player.audit_events WHERE event = 'login.refused'"
    ).fetchone()
    assert event == (passkey,)
    # The challenge is used up: the same answer again is refused before the account is found.
    assert _count(site, "login_challenges") == 0


@pytest.mark.parametrize("kind", CLOSED)
def test_a_closed_kinds_passkey_is_refused_whatever_its_challenge_and_counter(
    site: Site, kind: str
) -> None:
    """Called as the backend calls it, after a signature check: the kind is refused first."""
    account = _account(site, kind)
    authenticator = Authenticator()
    site.su.execute(
        "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
        "VALUES (%s, %s, %s, 'Laptop')",
        (account, authenticator.credential_id, authenticator.cose_key()),
    )
    browser = site.browser()
    options = options_of(browser.post(SIGN_IN_OPTIONS))
    credential = authenticator.get(options, counter=7)
    refused = browser.post(SIGN_IN, json={"credential": credential})
    assert refused.status_code == 401
    assert _events(site, account) == [
        ("login.refused", "passkey", {"method": "passkey", "reason": "closed"})
    ]
    assert site.su.execute("SELECT sign_count, last_used_at FROM player.passkeys").fetchone() == (
        0,
        None,
    )
    assert _count(site, "sessions") == 0
