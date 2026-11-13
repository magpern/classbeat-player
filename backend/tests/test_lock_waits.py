"""The waits for the account's sign-in lock and its passkey-additions lock are bounded (#158;
ADR 0002, sections 5 and 10).

While another transaction holds the lock, a link sign-in, a passkey sign-in and a passkey
addition each wait for it at most `BUDGET` seconds, then get 429 with `Retry-After: 1` and
change nothing: no session, passkey, event or counter is written, and the link, the challenge
or the registration is not used up. Once the lock is released the same request succeeds.

Each request runs on a thread that must end within `LIMIT`: without the bound it waits until
the holder commits, so a removed bound fails the test instead of hanging it. The functions and
the additions lock put the caller's own `lock_timeout` back once the lock is held, so the bound
covers that lock alone.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import LiteralString

import httpx
import psycopg
import pytest

from player_backend.db import passkeys
from player_backend.db.context import AccountContext
from player_backend.db.executor import connect
from player_backend.lock_registry import ACCOUNT_SESSIONS, PASSKEY_ADDITIONS
from player_backend.passkey_policy import BUSY_RETRY_SECONDS
from tests.dbhelp import Conn
from tests.passkeyhelp import (
    OPTIONS,
    PASSKEYS,
    SIGN_IN,
    SIGN_IN_OPTIONS,
    Authenticator,
    options_of,
    register,
)
from tests.sitehelp import Site

EMAIL = "rider@example.test"
COMPLETE = "/api/site/sign-in/complete"
CLIENT = "ROW('203.0.113.0/24'::cidr, 'Firefox')::player.client_info"
COMPLETE_LINK = f"SELECT player.auth_complete_login(%s, %s, %s, {CLIENT})"
COMPLETE_PASSKEY = f"SELECT player.auth_complete_passkey(%s, %s, %s, %s, %s, {CLIENT})"
# The bound: 0012_bounded_lock_waits.sql and passkey_policy.ADDITIONS_LOCK_WAIT.
BUDGET = 2.0
# How long a request may take here before the test fails: the bound and a margin.
LIMIT = BUDGET + 2.0
BUSY = (429, str(BUSY_RETRY_SECONDS), {"error": "too_many_requests"})

type Answer = tuple[int, str | None, object]


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def _signed(key: int) -> int:
    return key - (1 << 32) if key >= 1 << 31 else key


def _account_key(account: uuid.UUID) -> int:
    """The lock's second key for an account, as the SQL computes it."""
    return _signed(int(account.hex[:8], 16))


@pytest.fixture
def holder(db_url: str) -> Iterator[Conn]:
    """A connection of its own, in a transaction until it commits."""
    with psycopg.connect(db_url) as conn:
        yield conn
        conn.rollback()


def _account(site: Site) -> uuid.UUID:
    row = site.su.execute("SELECT id FROM player.accounts WHERE email = %s", (EMAIL,)).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _hold(holder: Conn, number: int, account: uuid.UUID) -> None:
    holder.execute("SELECT pg_advisory_xact_lock(%s, %s)", (number, _account_key(account)))


def _state(site: Site) -> dict[str, list[tuple[object, ...]]]:
    """What a refused request must leave as it was. A session's "last used" is left out: the
    session of an addition was used."""
    queries: dict[str, LiteralString] = {
        "accounts": "SELECT id FROM player.accounts ORDER BY id",
        "sessions": "SELECT id FROM player.sessions ORDER BY id",
        "passkeys": "SELECT id, sign_count, last_used_at FROM player.passkeys ORDER BY id",
        "events": "SELECT id, event FROM player.audit_events ORDER BY id",
        "links": "SELECT id, usable FROM player.login_links ORDER BY id",
        "challenges": "SELECT challenge_hash FROM player.login_challenges ORDER BY 1",
        "registrations": "SELECT id FROM player.passkey_registrations ORDER BY id",
        "counters": "SELECT key_hash, window_start, hits FROM player.rate_limits ORDER BY 1, 2",
    }
    return {name: [tuple(r) for r in site.su.execute(q).fetchall()] for name, q in queries.items()}


def _answer(response: httpx.Response) -> Answer:
    return (response.status_code, response.headers.get("Retry-After"), response.json())


def _busy_within_the_bound(holder: Conn, call: Callable[[], httpx.Response]) -> None:
    """`call` waits for the lock `holder` holds, then gets 429 within the bound."""
    result: list[Answer] = []
    started = time.monotonic()
    thread = threading.Thread(target=lambda: result.append(_answer(call())), daemon=True)
    thread.start()
    try:
        thread.join(LIMIT)
        elapsed = time.monotonic() - started
        assert not thread.is_alive(), "the wait for the lock was not bounded"
    finally:
        holder.commit()  # lets an unbounded wait end, so the thread does not outlive the test
        thread.join(10)
    assert result == [BUSY]
    # It waited for the lock, not less than the bound: a refusal at once would be a try-lock.
    assert elapsed >= BUDGET * 0.9


def test_a_link_sign_in_waits_for_the_account_lock_at_most_the_bound(
    site: Site, holder: Conn
) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)
    browser = site.browser()
    token = site.ask(browser, EMAIL)
    assert token is not None
    _hold(holder, ACCOUNT_SESSIONS, _account(site))
    before = _state(site)
    _busy_within_the_bound(holder, lambda: browser.post(COMPLETE, json={"token": token}))
    assert _state(site) == before
    # The lock is released: the same link signs in.
    answer = browser.post(COMPLETE, json={"token": token})
    assert answer.status_code == 200 and answer.json() == {"status": "signed_in"}
    assert len(_state(site)["sessions"]) == len(before["sessions"]) + 1


def test_a_passkey_sign_in_waits_for_the_account_lock_at_most_the_bound(
    site: Site, holder: Conn
) -> None:
    site.allow(EMAIL)
    authenticator = Authenticator()
    assert register(site.sign_in(EMAIL), authenticator).status_code == 201
    browser = site.browser()
    credential = authenticator.get(options_of(browser.post(SIGN_IN_OPTIONS)))
    _hold(holder, ACCOUNT_SESSIONS, _account(site))
    before = _state(site)
    _busy_within_the_bound(holder, lambda: browser.post(SIGN_IN, json={"credential": credential}))
    # The challenge is not used up, the counter not moved, no failure counted.
    assert _state(site) == before
    # The lock is released: the same answer signs in.
    answer = browser.post(SIGN_IN, json={"credential": credential})
    assert answer.status_code == 200 and answer.json() == {"status": "signed_in"}
    assert len(_state(site)["sessions"]) == len(before["sessions"]) + 1


def test_a_passkey_addition_waits_for_the_additions_lock_at_most_the_bound(
    site: Site, holder: Conn
) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    credential = Authenticator().create(options_of(browser.post(OPTIONS)))
    body = {"name": "Laptop", "credential": credential}
    _hold(holder, PASSKEY_ADDITIONS, _account(site))
    before = _state(site)
    mails = len(site.mailer.sent)
    _busy_within_the_bound(holder, lambda: browser.post(PASSKEYS, json=body))
    # The registration challenge is not used up and no passkey, event or notice is made.
    assert _state(site) == before
    assert len(site.mailer.sent) == mails
    # The lock is released: the same answer adds the passkey.
    answer = browser.post(PASSKEYS, json=body)
    assert answer.status_code == 201
    assert len(_state(site)["passkeys"]) == 1


def test_the_sign_in_functions_put_the_callers_lock_timeout_back(site: Site, db_url: str) -> None:
    """The bound is set around the lock alone: what the caller had is in force afterwards."""
    site.allow(EMAIL)
    site.sign_in(EMAIL)
    account = _account(site)
    link, browser = _h(), _h()
    site.su.execute(
        "INSERT INTO player.login_links (email, link_hash, browser_hash, usable, expires_at) "
        "VALUES (%s, %s, %s, true, now() + interval '15 minutes')",
        (EMAIL, link, browser),
    )
    credential, challenge, passkey_browser = _h(), _h(), _h()
    site.su.execute(
        "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
        "VALUES (%s, %s, 'key', 'Laptop')",
        (account, credential),
    )
    site.su.execute("SELECT player.auth_new_login_challenge(%s, %s)", (challenge, passkey_browser))
    with psycopg.connect(db_url) as conn:
        conn.execute("SET lock_timeout = '7s'")
        assert conn.execute(COMPLETE_LINK, (link, browser, _h())).fetchone() == (True,)
        assert conn.execute("SHOW lock_timeout").fetchone() == ("7s",)
        signed_in = conn.execute(
            COMPLETE_PASSKEY, (credential, challenge, passkey_browser, 1, _h())
        ).fetchone()
        assert signed_in == (True,)
        assert conn.execute("SHOW lock_timeout").fetchone() == ("7s",)
        conn.rollback()


def test_the_additions_lock_puts_the_callers_lock_timeout_back(site: Site, db_url: str) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)
    account = _account(site)
    with connect(db_url) as db, db.transaction():
        ctx = AccountContext(
            account_id=account,
            credential_kind="session",
            credential_id=uuid.uuid4(),
            signed_in_at=None,
            entered_at=datetime.now(UTC),
            db=db,
        )
        db.rows(passkeys.q.SET_LOCK_WAIT, ("7s",))
        assert passkeys.lock_additions(ctx) is True
        assert db.rows(passkeys.q.LOCK_WAIT_NOW) == [("7s",)]
