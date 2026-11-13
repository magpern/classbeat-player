"""The account's export is streamed (ADR 0002, section 12): classes are read a page of at most
16 at a time, each page in a short transaction of its own that enters the session again, and
the stream stops when the session ends or the account goes before a page."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Iterator, Mapping
from contextlib import AbstractContextManager
from types import SimpleNamespace
from typing import Any, cast
from uuid import UUID

import pytest

from player_backend.account_policy import EXPORT_PAGE, export_limit_key
from player_backend.db import account as account_db
from player_backend.db import site_sessions
from player_backend.db.executor import Handle
from player_backend.db.queries import account as q
from player_backend.site import account as site_account
from tests import sourcehelp as sh
from tests.accounthelp import EXPORT
from tests.pairhelp import settle
from tests.sitehelp import Browser, Site

A = "a@example.test"
MANY = 40

type Entered = Callable[[Any, bytes], AbstractContextManager[Any]]


def _with_classes(site: Site, count: int) -> tuple[Browser, UUID]:
    """A signed-in account with `count` classes, published one after another."""
    site.allow(A)
    browser = site.sign_in(A, site.browser("198.51.100.1"))
    token = sh.link(site, browser)
    server = sh.server(site, "192.0.2.21")
    for number in range(count):
        body = sh.envelope(f"c{number:02}", 1, sh.document(f"Class {number:02}"))
        answer = sh.publish(server, token, body)
        assert answer.status_code == 200 and answer.json()["status"] == "applied"
    row = site.su.execute("SELECT id FROM player.accounts WHERE email = %s", (A,)).fetchone()
    assert row is not None and isinstance(row[0], UUID)
    return browser, row[0]


def _page_sizes(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """The number of rows each class page query returns, in order."""
    sizes: list[int] = []
    real = Handle.rows

    def counted(self: Handle, query: Any, params: Any = None, /) -> list[Any]:
        found = real(self, query, params)
        if query is q.CLASS_PAGE:
            sizes.append(len(found))
        return found

    monkeypatch.setattr(Handle, "rows", counted)
    return sizes


def _before_each_page(monkeypatch: pytest.MonkeyPatch, before: Callable[[int], None]) -> list[int]:
    """Run `before(n)` before the export enters the session for its page n (from 1)."""
    real = cast("Entered", site_sessions.entered)
    pages: list[int] = []

    def entered(pool: Any, token_hash: bytes) -> AbstractContextManager[Any]:
        pages.append(len(pages) + 1)
        before(len(pages))
        return real(pool, token_hash)

    monkeypatch.setattr(account_db, "site_sessions", SimpleNamespace(entered=entered))
    return pages


def _open_transactions(site: Site) -> int:
    row = site.su.execute(
        "SELECT count(*)::int FROM pg_stat_activity "
        "WHERE datname = current_database() AND state LIKE 'idle in transaction%%' "
        "AND pid <> pg_backend_pid()"
    ).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


def test_classes_are_read_a_page_of_16_at_a_time(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser, _ = _with_classes(site, MANY)
    sizes = _page_sizes(monkeypatch)
    held: list[int] = []
    _before_each_page(monkeypatch, lambda _: held.append(_open_transactions(site)))
    answer = browser.post(EXPORT)
    assert answer.status_code == 200
    assert answer.headers["content-type"] == "application/json"
    assert answer.headers["content-disposition"].startswith("attachment;")
    body: dict[str, Any] = answer.json()
    # Every class, once, in the order they were published.
    assert [c["source_class_id"] for c in body["classes"]] == [f"c{n:02}" for n in range(MANY)]
    # No query returns more than a page; the last, short page ends the stream.
    assert EXPORT_PAGE == 16 and sizes == [16, 16, 8]
    # No transaction is held open between pages: not the request's, not the last page's.
    assert len(held) == 3 and held == [0, 0, 0]


def test_no_transaction_is_held_while_the_stream_is_paused_on_a_page(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Measured at every chunk, while the class pages wait at their `yield` for the client: a
    page written while its transaction is still open fails here (#115)."""
    browser, _ = _with_classes(site, MANY)
    real = site_account.export_chunks
    held: list[int] = []

    def measured(
        head: Mapping[str, object], classes: Iterable[Mapping[str, object]]
    ) -> Iterator[bytes]:
        for chunk in real(head, classes):
            held.append(_open_transactions(site))
            yield chunk

    monkeypatch.setattr(site_account, "export_chunks", measured)
    answer = browser.post(EXPORT)
    assert len(answer.json()["classes"]) == MANY
    # The opening, one chunk per class, the close: each written with no transaction open.
    assert len(held) == MANY + 2 and set(held) == {0}


def test_a_class_published_again_during_the_export_is_listed_once(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser, account_id = _with_classes(site, MANY)

    def republish_before_second(page: int) -> None:
        if page != 2:
            return
        # As an applied publication does: the next place in the account's order, a new number.
        place = site.su.execute(
            "UPDATE player.account_sync SET position = position + 1 WHERE account_id = %s "
            "RETURNING position",
            (account_id,),
        ).fetchone()
        assert place is not None
        moved = site.su.execute(
            "UPDATE player.classes SET publication_number = 2, sync_position = %s "
            "WHERE account_id = %s AND source_class_id = 'c00'",
            (place[0], account_id),
        )
        assert moved.rowcount == 1

    _before_each_page(monkeypatch, republish_before_second)
    classes: list[dict[str, Any]] = browser.post(EXPORT).json()["classes"]
    listed = [c["source_class_id"] for c in classes]
    # Read on the first page, then moved to the end of the order: still listed once, as read.
    assert listed == [f"c{n:02}" for n in range(MANY)]
    assert classes[0]["publication_number"] == 1


def test_a_full_last_page_is_followed_by_an_empty_one(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser, _ = _with_classes(site, 2 * EXPORT_PAGE)
    sizes = _page_sizes(monkeypatch)
    assert len(browser.post(EXPORT).json()["classes"]) == 2 * EXPORT_PAGE
    assert sizes == [16, 16, 0]


@pytest.mark.parametrize("ended", ["session", "account"])
def test_the_stream_stops_when_the_session_or_account_goes_mid_export(
    site: Site, monkeypatch: pytest.MonkeyPatch, ended: str
) -> None:
    browser, account_id = _with_classes(site, MANY)
    sizes = _page_sizes(monkeypatch)
    statement = (
        "DELETE FROM player.sessions WHERE account_id = %s"
        if ended == "session"
        else "DELETE FROM player.accounts WHERE id = %s"
    )

    def end_before_second(page: int) -> None:
        if page == 2:
            site.su.execute(statement, (account_id,))

    pages = _before_each_page(monkeypatch, end_before_second)
    answer = browser.post(EXPORT)
    # The answer had begun: its status was sent before the classes.
    assert answer.status_code == 200
    # Only the first page was read and written; the document is left open, so it is not JSON.
    assert sizes == [16] and pages == [1, 2]
    with pytest.raises(json.JSONDecodeError):
        json.loads(answer.content)
    text = answer.content.decode()
    # The head came whole (its events name every class); the classes stop after the first page.
    _, classes = text.split('"classes":[', 1)
    assert classes.count('"removed":') == EXPORT_PAGE
    assert '"source_class_id":"c15"' in classes and '"source_class_id":"c16"' not in classes
    assert not text.endswith("]}")


def test_a_small_export_is_one_valid_document_of_the_whole_layout(site: Site) -> None:
    browser, _ = _with_classes(site, 1)
    answer = browser.post(EXPORT)
    body: dict[str, Any] = json.loads(answer.content)
    # The same parts as when the export was made in memory, and nothing else.
    assert set(body) == {
        "format",
        "exported_at",
        "account",
        "classes",
        "devices",
        "source_links",
        "passkeys",
        "sessions",
        "audit_events",
    }
    (entry,) = body["classes"]
    assert set(entry) == {
        "source",
        "source_class_id",
        "publication_number",
        "removed",
        "published_at",
        "document",
    }
    assert entry["document"]["class"]["title"] == "Class 00" and entry["removed"] is False


def test_the_count_is_kept_on_a_refused_export(site: Site) -> None:
    browser, account_id = _with_classes(site, 0)
    settle(site, 86400)
    for _ in range(3):
        assert browser.post(EXPORT).status_code == 200
    assert browser.post(EXPORT).status_code == 429
    row = site.su.execute(
        "SELECT hits FROM player.rate_limits WHERE key_hash = %s "
        "ORDER BY window_start DESC LIMIT 1",
        (export_limit_key(account_id),),
    ).fetchone()
    # The refused fourth is counted too: returned, not raised, so not rolled back.
    assert row is not None and row[0] == 4
