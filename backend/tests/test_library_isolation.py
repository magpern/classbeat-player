"""The class library on the site keeps to its account twice (ADR 0002, section 9): in the
code, and by row-level security at the database.

- With no policy (a pool of the throwaway server's superuser, which row-level security does
  not hold), whatever keeps another account's classes out is the query's own `account_id`.
- With the policy (the backend's own pool, as `player_app`, entered as one account), the code
  is told the other account's id: the database still shows and changes nothing of it.

The routes' side is in tests/guards/test_guard_endpoint_isolation.py.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace
from uuid import UUID

import pytest
from psycopg import errors

from player_backend.client_policy import ClientInfo
from player_backend.db import library, site_sessions
from player_backend.db.executor import Pool, open_pool
from player_backend.library_policy import PageRequest
from player_backend.token_policy import token_hash
from tests import sourcehelp as sh
from tests.dbhelp import as_role, set_account
from tests.sitehelp import SESSION_COOKIE, Site

MINE = "rider@example.test"
THEIRS = "other@example.test"
CLIENT = ClientInfo(network="203.0.113.0/24", family="Firefox")
ALL = PageRequest(None, 200)


@dataclass(frozen=True)
class Two:
    token: bytes  # my session's token hash
    mine: UUID
    theirs: UUID
    my_classes: list[UUID]
    their_classes: list[UUID]


@pytest.fixture
def no_policy(db_url: str) -> Iterator[Pool]:
    pool = open_pool(db_url, max_size=1)
    try:
        yield pool
    finally:
        pool.close()


def _account(site: Site, email: str, titles: tuple[str, ...]) -> tuple[bytes, UUID, list[UUID]]:
    site.allow(email)
    browser = site.sign_in(email)
    token = sh.link(site, browser)
    server = sh.server(site)
    for n, title in enumerate(titles, start=1):
        # The same keys in both accounts: each account's are its own.
        published = sh.publish(server, token, sh.envelope(f"c{n}", n, sh.document(title)))
        assert published.status_code == 200
    account = site.su.execute("SELECT id FROM player.accounts WHERE email = %s", (email,))
    row = account.fetchone()
    assert row is not None and isinstance(row[0], UUID)
    ids = site.su.execute(
        "SELECT id FROM player.classes WHERE account_id = %s ORDER BY sync_position", (row[0],)
    ).fetchall()
    cookie = browser.cookies.get(SESSION_COOKIE)
    assert cookie is not None
    return token_hash(cookie), row[0], [i[0] for i in ids if isinstance(i[0], UUID)]


def _two(site: Site) -> Two:
    token, mine, my_classes = _account(site, MINE, ("Mine 1", "Mine 2"))
    _, theirs, their_classes = _account(site, THEIRS, ("Theirs 1", "Theirs 2", "Theirs 3"))
    return Two(token, mine, theirs, my_classes, their_classes)


def _rows(site: Site, account: UUID) -> list[tuple[object, ...]]:
    return site.su.execute(
        "SELECT c::text FROM player.classes c WHERE account_id = %s ORDER BY id", (account,)
    ).fetchall()


def _events(site: Site, account: UUID) -> list[tuple[object, ...]]:
    return site.su.execute(
        "SELECT event FROM player.audit_events WHERE account_id = %s ORDER BY id", (account,)
    ).fetchall()


def test_the_library_queries_keep_to_their_account_with_no_policy(
    site: Site, no_policy: Pool
) -> None:
    two = _two(site)
    theirs_before, their_events = _rows(site, two.theirs), _events(site, two.theirs)
    with site_sessions.entered(no_policy, two.token) as context:
        assert context is not None and context.account_id == two.mine
        page = library.list_classes(context, ALL)
        assert [e.id for e in page.entries] == two.my_classes[::-1]
        assert [e.title for e in page.entries] == ["Mine 2", "Mine 1"]
        for class_id in two.their_classes:
            assert library.read_class(context, class_id) is None
            assert library.delete_class(context, class_id, CLIENT) is False
        # No policy is in the way here: asked with the other account, the same connection
        # gives the other account's rows. With the policy it gives none (the test below).
        as_them = replace(context, account_id=two.theirs)
        assert [e.id for e in library.list_classes(as_them, ALL).entries] == (
            two.their_classes[::-1]
        )
    assert _rows(site, two.theirs) == theirs_before
    assert _events(site, two.theirs) == their_events


def test_row_level_security_holds_when_the_code_names_the_other_account(site: Site) -> None:
    two = _two(site)
    theirs_before, their_events = _rows(site, two.theirs), _events(site, two.theirs)
    with site_sessions.entered(site.app.state.site.pool, two.token) as context:
        assert context is not None and context.account_id == two.mine
        # The database has my account set; the code is told theirs.
        as_them = replace(context, account_id=two.theirs)
        page = library.list_classes(as_them, ALL)
        assert (page.entries, page.cursor, page.more) == ([], None, False)
        for class_id in two.their_classes:
            assert library.read_class(as_them, class_id) is None
            assert library.delete_class(as_them, class_id, CLIENT) is False
        # And the account the database has set still sees its own.
        assert [e.id for e in library.list_classes(context, ALL).entries] == two.my_classes[::-1]
    assert _rows(site, two.theirs) == theirs_before
    assert _events(site, two.theirs) == their_events


def test_as_player_app_another_accounts_class_cannot_be_read_marked_or_deleted(
    site: Site,
) -> None:
    two = _two(site)
    theirs_before = _rows(site, two.theirs)
    target = two.their_classes[0]
    with site.su.transaction():
        as_role(site.su, "player_app")
        set_account(site.su, two.mine)
        seen = site.su.execute("SELECT count(*) FROM player.classes WHERE id = %s", (target,))
        assert seen.fetchone() == (0,)
        marked = site.su.execute(
            "UPDATE player.classes SET kind = 'removal', content_hash = NULL, document = NULL "
            "WHERE id = %s RETURNING id",
            (target,),
        )
        assert marked.fetchall() == []
    # A marker is never deleted: the backend's role has no DELETE on classes at all.
    with pytest.raises(errors.InsufficientPrivilege), site.su.transaction():
        as_role(site.su, "player_app")
        set_account(site.su, two.mine)
        site.su.execute("DELETE FROM player.classes WHERE id = %s", (two.my_classes[0],))
    assert _rows(site, two.theirs) == theirs_before
