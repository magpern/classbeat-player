"""The session queries filter by the account in the code (ADR 0002, section 9: isolation is done
twice). Here they run with no policy behind them: on a pool connected as the throwaway server's
superuser, which row-level security does not apply to. Whatever keeps another account's rows
out is the query's own `account_id = ...`.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace
from uuid import UUID

import pytest

from player_backend.client_policy import ClientInfo
from player_backend.db import site_sessions
from player_backend.db.executor import Pool, open_pool
from player_backend.token_policy import token_hash
from tests.sitehelp import SESSION_COOKIE, Browser, Site

MINE = "rider@example.test"
THEIRS = "other@example.test"
CLIENT = ClientInfo(network="203.0.113.0/24", family="Firefox")


@pytest.fixture
def no_policy(db_url: str) -> Iterator[Pool]:
    pool = open_pool(db_url, max_size=1)
    try:
        yield pool
    finally:
        pool.close()


def _token(browser: Browser) -> bytes:
    token = browser.cookies.get(SESSION_COOKIE)
    assert token is not None
    return token_hash(token)


def _sessions(site: Site, email: str) -> set[UUID]:
    found = site.su.execute(
        "SELECT s.id FROM player.sessions s JOIN player.accounts a ON a.id = s.account_id "
        "WHERE a.email = %s",
        (email,),
    ).fetchall()
    return {row[0] for row in found if isinstance(row[0], UUID)}


def _two_accounts(site: Site) -> tuple[bytes, set[UUID], set[UUID]]:
    """My session's token hash, my sessions and theirs: two each."""
    site.allow(MINE)
    site.allow(THEIRS)
    me = site.sign_in(MINE)
    site.sign_in(MINE)
    site.sign_in(THEIRS)
    site.sign_in(THEIRS)
    mine, theirs = _sessions(site, MINE), _sessions(site, THEIRS)
    assert len(mine) == len(theirs) == 2
    return _token(me), mine, theirs


def test_listing_returns_the_accounts_own_sessions_with_no_policy(
    site: Site, no_policy: Pool
) -> None:
    token, mine, theirs = _two_accounts(site)
    their_account = site.su.execute(
        "SELECT id FROM player.accounts WHERE email = %s", (THEIRS,)
    ).fetchone()
    assert their_account is not None and isinstance(their_account[0], UUID)
    with site_sessions.entered(no_policy, token) as context:
        assert context is not None
        assert {s.id for s in site_sessions.list_sessions(context)} == mine
        # No policy is in the way here: asked with the other account, the same connection in the
        # same transaction gives the other account's rows. With the policy it would give none.
        as_them = replace(context, account_id=their_account[0])
        assert {s.id for s in site_sessions.list_sessions(as_them)} == theirs


def test_ending_one_session_cannot_reach_another_account_with_no_policy(
    site: Site, no_policy: Pool
) -> None:
    token, mine, theirs = _two_accounts(site)
    with site_sessions.entered(no_policy, token) as context:
        assert context is not None
        for session_id in theirs:
            assert site_sessions.end_session(context, session_id, CLIENT) is False
        other = next(iter(mine - {context.credential_id}))
        assert site_sessions.end_session(context, other, CLIENT) is True
    assert _sessions(site, THEIRS) == theirs
    assert _sessions(site, MINE) == mine - {other}
    assert site.events(THEIRS)[-1][0] == "login.signed_in"  # no event in their account


def test_ending_all_sessions_leaves_another_accounts_with_no_policy(
    site: Site, no_policy: Pool
) -> None:
    token, _, theirs = _two_accounts(site)
    with site_sessions.entered(no_policy, token) as context:
        assert context is not None
        assert site_sessions.end_all_sessions(context, CLIENT) == 2
    assert _sessions(site, MINE) == set()
    assert _sessions(site, THEIRS) == theirs
