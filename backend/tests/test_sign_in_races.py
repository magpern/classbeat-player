"""Two things at once (ADR 0002, sections 4 and 5): two link requests from one browser leave one
usable link, and two sign-ins to one account leave at most 20 sessions.

Each test holds one call's transaction open on a connection of its own, starts the second call
on another, sees it wait, and only then lets the first one commit.
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Iterator

import psycopg
import pytest

from tests.dbhelp import Conn
from tests.sitehelp import Site

EMAIL = "rider@example.test"
CLIENT = "ROW('203.0.113.0/24'::cidr, 'Firefox')::player.client_info"
REQUEST = f"SELECT player.auth_request_login(%s, %s, %s, %s, {CLIENT})"
COMPLETE = f"SELECT player.auth_complete_login(%s, %s, %s, {CLIENT})"
LINK_LOCK = 7270002
SESSION_LOCK = 7270003


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


@pytest.fixture
def two(db_url: str) -> Iterator[tuple[Conn, Conn]]:
    """Two connections, each in a transaction of its own until it commits."""
    with psycopg.connect(db_url) as first, psycopg.connect(db_url) as second:
        yield first, second


def _advisory(site: Site, conn: Conn, granted: bool) -> list[int]:
    """The first key of the advisory locks `conn` holds, or is waiting for."""
    found = site.su.execute(
        "SELECT classid::int FROM pg_locks WHERE locktype = 'advisory' AND pid = %s "
        "AND granted = %s",
        (conn.info.backend_pid, granted),
    ).fetchall()
    return [int(str(row[0])) for row in found]


def _in_background(
    conn: Conn, statement: str, params: tuple[object, ...]
) -> tuple[threading.Thread, list[object]]:
    """Run a call and commit it on a thread. The list gets what the call returned."""
    result: list[object] = []

    def run() -> None:
        row = conn.execute(statement.encode(), params).fetchone()
        conn.commit()
        result.append(row[0] if row is not None else None)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread, result


def _wait_until_blocked(site: Site, conn: Conn) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        state = site.su.execute(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = %s",
            (conn.info.backend_pid,),
        ).fetchone()
        if state == ("Lock",):
            return
        time.sleep(0.01)
    pytest.fail("the second call did not wait for the first")


def test_two_requests_at_once_from_one_browser_leave_one_usable_link(
    site: Site, two: tuple[Conn, Conn]
) -> None:
    site.allow(EMAIL)
    first, second = two
    browser, link_one, link_two = _h(), _h(), _h()
    # The two requests come from different addresses, so they share no per-pair counter.
    assert first.execute(REQUEST.encode(), (EMAIL, link_one, browser, _h())).fetchone() == (True,)
    # The first holds the lock of this email and browser until it commits.
    assert _advisory(site, first, granted=True) == [LINK_LOCK]
    thread, result = _in_background(second, REQUEST, (EMAIL, link_two, browser, _h()))
    _wait_until_blocked(site, second)
    assert result == []
    first.commit()
    thread.join(10)
    assert result == [True]
    usable = site.su.execute(
        "SELECT link_hash FROM player.login_links WHERE email = %s AND browser_hash = %s "
        "AND usable",
        (EMAIL, browser),
    ).fetchall()
    # The newer link cancelled the older one, although both were asked for at once.
    assert usable == [(link_two,)]


def test_a_request_for_another_email_does_not_wait_and_cancels_nothing(
    site: Site, two: tuple[Conn, Conn]
) -> None:
    site.allow(EMAIL)
    first, second = two
    other = "other@example.test"
    site.allow(other)
    assert first.execute(REQUEST.encode(), (EMAIL, _h(), _h(), _h())).fetchone() == (True,)
    # Another email is not held up by the open request (same browser or not).
    assert second.execute(REQUEST.encode(), (other, _h(), _h(), _h())).fetchone() == (True,)
    second.commit()
    first.commit()
    count = site.su.execute("SELECT count(*) FROM player.login_links WHERE usable").fetchone()
    assert count == (2,)


def test_two_sign_ins_at_once_leave_20_sessions(site: Site, two: tuple[Conn, Conn]) -> None:
    site.allow(EMAIL)
    site.sign_in(EMAIL)
    account = site.su.execute("SELECT id FROM player.accounts").fetchone()
    assert account is not None
    site.su.execute("UPDATE player.sessions SET created_at = now() - interval '30 days'")
    for day in range(1, 20):
        site.su.execute(
            "INSERT INTO player.sessions (account_id, token_hash, created_at) "
            "VALUES (%s, %s, now() - %s * interval '1 day')",
            (account[0], _h(), day),
        )
    # Two links, asked from two browsers: both usable.
    links = [(_h(), _h()) for _ in range(2)]
    for link, browser in links:
        assert site.su.execute(REQUEST.encode(), (EMAIL, link, browser, _h())).fetchone() == (True,)
    first, second = two
    session_one, session_two = _h(), _h()
    assert first.execute(COMPLETE.encode(), (*links[0], session_one)).fetchone() == (True,)
    assert _advisory(site, first, granted=True) == [SESSION_LOCK]
    thread, result = _in_background(second, COMPLETE, (*links[1], session_two))
    _wait_until_blocked(site, second)
    # It waits for the account's sign-in lock, before it has made its session.
    assert _advisory(site, second, granted=False) == [SESSION_LOCK]
    first.commit()
    thread.join(10)
    assert result == [True]
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (20,)
    kept = site.su.execute(
        "SELECT count(*) FROM player.sessions WHERE token_hash = ANY(%s)",
        ([session_one, session_two],),
    ).fetchone()
    assert kept == (2,)  # the oldest were dropped, never a new one
