"""Class sync through the player API (ADR 0002, sections 6, 7, 9 and 10): the changes since a
cursor in pages, one class by its id, the current cursor, and the device token's answers.

Classes are published through the source API's own route, so the numbers, kinds, hashes and
places are what the source side really wrote.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

import pytest

from player_backend.publication_policy import content_hash
from player_backend.token_issue import new_token
from tests import pairhelp
from tests import sourcehelp as sh
from tests.pairhelp import bearer
from tests.sitehelp import Browser, Site

EMAIL = "rider@example.test"
OTHER = "other@example.test"
CHANGES = "/api/player/changes"
CLASSES = "/api/player/classes"
CURSOR = "/api/player/cursor"


@dataclass(frozen=True)
class Account:
    browser: Browser
    app: Browser
    token: str  # the device token
    server: Browser
    source_token: str

    def get(self, path: str) -> dict[str, Any]:
        answer = self.app.get(path, headers=bearer(self.token))
        assert answer.status_code == 200, answer.text
        assert answer.headers["cache-control"] == "no-store"
        return cast("dict[str, Any]", answer.json())

    def publish(self, class_id: str, number: int, title: str | None) -> None:
        doc = None if title is None else sh.document(title)
        answer = sh.publish(self.server, self.source_token, sh.envelope(class_id, number, doc))
        assert answer.status_code == 200 and answer.json()["status"] == "applied", answer.text


def _account(site: Site, email: str = EMAIL, address: str = "198.51.100.1") -> Account:
    site.allow(email)
    browser = site.sign_in(email, site.browser(address))
    app = pairhelp.app_client(site, address)
    token = pairhelp.pair(site, browser, "Studio PC", app)
    source_token = sh.link(site, browser)
    return Account(browser, app, token, sh.server(site, "192.0.2.30"), source_token)


def _changes(account: Account, query: str = "") -> list[tuple[object, ...]]:
    body = account.get(CHANGES + query)
    found: list[dict[str, Any]] = body["changes"]
    return [(c["source_class_id"], c["publication_number"], c["removed"]) for c in found]


def _stored(site: Site) -> list[tuple[object, ...]]:
    """Everything sync could write but must not: classes, cursors and events."""
    found: list[tuple[object, ...]] = []
    for statement in (
        "SELECT c::text FROM player.classes c ORDER BY c.id",
        "SELECT y::text FROM player.account_sync y ORDER BY y.account_id",
        "SELECT e.id::text FROM player.audit_events e ORDER BY e.id",
        "SELECT d.id::text, d.revoked_at FROM player.devices d ORDER BY d.id",
    ):
        found.extend(site.su.execute(statement).fetchall())
    return found


def test_an_empty_account_has_no_changes_and_cursor_zero(site: Site) -> None:
    account = _account(site)
    assert account.get(CHANGES) == {"changes": [], "cursor": 0, "more": False}
    assert account.get(CURSOR) == {"cursor": 0}
    # Any cursor above 0 was never this account's.
    refused = account.app.get(CHANGES + "?after=1", headers=bearer(account.token))
    assert refused.status_code == 409
    assert refused.json() == {"error": "resync_required", "cursor": 0}


def test_changes_come_in_sync_order_with_their_numbers_and_hashes(site: Site) -> None:
    account = _account(site)
    account.publish("one", 1, "First")
    account.publish("two", 5, "Second")
    body = account.get(CHANGES)
    assert body["cursor"] == 2 and body["more"] is False
    changes: list[dict[str, Any]] = body["changes"]
    first, second = changes
    assert set(first) == {
        "class_id",
        "source",
        "source_class_id",
        "publication_number",
        "removed",
        "content_hash",
        "published_at",
        "position",
    }
    assert (first["source"], first["source_class_id"], first["position"]) == ("classbeat", "one", 1)
    assert first["content_hash"] == content_hash(sh.document("First"))
    assert (second["source_class_id"], second["publication_number"], second["position"]) == (
        "two",
        5,
        2,
    )
    # No content in a change: not the title, not the document.
    assert "First" not in str(changes) and "document" not in str(changes)
    assert account.get(CURSOR) == {"cursor": 2}


def test_a_removal_after_a_class_is_one_change_with_no_hash(site: Site) -> None:
    account = _account(site)
    account.publish("gone", 1, "Soon gone")
    account.publish("kept", 1, "Kept")
    first: list[dict[str, Any]] = account.get(CHANGES)["changes"]
    gone_id = next(c["class_id"] for c in first if c["source_class_id"] == "gone")
    assert account.get(f"{CLASSES}/{gone_id}")["document"] is not None
    account.publish("gone", 2, None)
    # The class's row moved to the end of the order as a removal: one change, not two.
    assert _changes(account) == [("kept", 1, False), ("gone", 2, True)]
    after_kept = account.get(CHANGES + "?after=2")
    assert after_kept["cursor"] == 3
    changes: list[dict[str, Any]] = after_kept["changes"]
    assert len(changes) == 1
    removal = changes[0]
    assert removal["class_id"] == gone_id and removal["removed"] is True
    assert removal["content_hash"] is None and removal["position"] == 3
    # The marker holds no document: the class is not found any more.
    refused = account.app.get(f"{CLASSES}/{gone_id}", headers=bearer(account.token))
    assert refused.status_code == 404 and refused.json() == {"error": "not_found"}
    # Sent again with a higher number, it is a class again, at a new place.
    account.publish("gone", 3, "Back")
    assert _changes(account, "?after=3") == [("gone", 3, False)]
    assert account.get(f"{CLASSES}/{gone_id}")["publication_number"] == 3


def test_changes_come_in_pages_with_a_limit(site: Site) -> None:
    account = _account(site)
    for n in range(1, 6):
        account.publish(f"c{n}", n, f"Class {n}")
    seen: list[object] = []
    cursor = 0
    pages = 0
    while True:
        body = account.get(f"{CHANGES}?after={cursor}&limit=2")
        changes: list[dict[str, Any]] = body["changes"]
        assert len(changes) <= 2
        seen.extend(c["source_class_id"] for c in changes)
        assert isinstance(body["cursor"], int)
        cursor = body["cursor"]
        pages += 1
        if body["more"] is False:
            break
    assert seen == ["c1", "c2", "c3", "c4", "c5"]
    assert (pages, cursor) == (3, 5)
    # A page that ends exactly at the last change says so.
    assert account.get(f"{CHANGES}?after=3&limit=2")["more"] is False
    assert account.get(f"{CHANGES}?after=2&limit=2")["more"] is True
    # The current cursor is an empty page.
    assert account.get(f"{CHANGES}?after=5") == {"changes": [], "cursor": 5, "more": False}
    assert len(account.get(f"{CHANGES}?limit=500")["changes"]) == 5


@pytest.mark.parametrize(
    "query",
    [
        "?limit=0",
        "?limit=501",
        "?limit=-1",
        "?after=-1",
        "?after=9223372036854775808",
        "?after=x",
        "?limit=1.5",
    ],
)
def test_a_cursor_or_limit_out_of_range_is_refused(site: Site, query: str) -> None:
    account = _account(site)
    answer = account.app.get(CHANGES + query, headers=bearer(account.token))
    assert answer.status_code == 422 and answer.json() == {"error": "invalid_request"}


def test_a_cursor_from_another_account_reads_only_this_accounts_changes(site: Site) -> None:
    mine = _account(site)
    other = _account(site, OTHER, "198.51.100.2")
    for n in range(1, 5):
        other.publish(f"theirs-{n}", n, "Theirs")
    mine.publish("mine", 1, "Mine")
    their_cursor = other.get(CURSOR)["cursor"]
    assert their_cursor == 4 and mine.get(CURSOR) == {"cursor": 1}
    # Above this account's own cursor: never this account's, so the device resyncs in full.
    refused = mine.app.get(f"{CHANGES}?after={their_cursor}", headers=bearer(mine.token))
    assert refused.status_code == 409
    assert refused.json() == {"error": "resync_required", "cursor": 1}
    assert "theirs" not in refused.text
    # A cursor this account has reached reads this account's rows, and never the other's.
    assert _changes(mine, "?after=0") == [("mine", 1, False)]
    assert _changes(mine, "?after=1") == []
    their_ids = [c["class_id"] for c in other.get(CHANGES)["changes"]]
    for class_id in their_ids:
        answer = mine.app.get(f"{CLASSES}/{class_id}", headers=bearer(mine.token))
        assert answer.status_code == 404 and answer.json() == {"error": "not_found"}
    assert len(_changes(other)) == 4


def test_one_class_by_its_id(site: Site) -> None:
    account = _account(site)
    account.publish("one", 7, "The class")
    change = account.get(CHANGES)["changes"][0]
    body = account.get(f"{CLASSES}/{change['class_id']}")
    assert set(body) == {
        "class_id",
        "source",
        "source_class_id",
        "publication_number",
        "content_hash",
        "position",
        "document",
    }
    assert body["document"] == sh.document("The class")
    assert body["content_hash"] == change["content_hash"] == content_hash(sh.document("The class"))
    assert (body["source_class_id"], body["publication_number"], body["position"]) == ("one", 7, 1)
    unknown = account.app.get(
        f"{CLASSES}/00000000-0000-4000-8000-000000000000", headers=bearer(account.token)
    )
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
    malformed = account.app.get(f"{CLASSES}/not-an-id", headers=bearer(account.token))
    assert malformed.status_code == 422 and malformed.json() == {"error": "invalid_request"}


def test_sync_writes_nothing_but_the_device_tokens_own_use(site: Site) -> None:
    account = _account(site)
    account.publish("one", 1, "One")
    account.publish("two", 1, None)
    class_id = account.get(CHANGES)["changes"][0]["class_id"]
    before = _stored(site)
    for path in (CHANGES, f"{CHANGES}?after=1&limit=1", CURSOR, f"{CLASSES}/{class_id}"):
        account.get(path)
    for refused in (f"{CHANGES}?after=99", f"{CLASSES}/{new_uuid()}", f"{CHANGES}?limit=0"):
        assert account.app.get(refused, headers=bearer(account.token)).status_code in (
            404,
            409,
            422,
        )
    assert _stored(site) == before


def new_uuid() -> str:
    return "11111111-1111-4111-8111-111111111111"


@pytest.mark.parametrize("path", [CHANGES, CURSOR, f"{CLASSES}/{new_uuid()}"])
def test_the_sync_routes_answer_a_token_that_does_not_work_as_built(site: Site, path: str) -> None:
    account = _account(site)
    app = account.app

    def refused(value: str, error: str) -> None:
        answer = app.get(path, headers={"Authorization": value})
        assert answer.status_code == 401 and answer.json() == {"error": error}
        assert answer.headers["www-authenticate"] == "Bearer"

    # By shape, before any lookup: no token, a token of another type.
    assert app.get(path).status_code == 401
    refused("Bearer " + account.source_token, "invalid_token")
    refused("Bearer " + new_token("dev"), "token_unknown")
    # The session cookie is not a credential here.
    assert account.browser.get(path).status_code == 401
    site.su.execute(
        "UPDATE player.devices SET created_at = now() - interval '1 year', "
        "last_used_at = now() - interval '181 days'"
    )
    refused("Bearer " + account.token, "token_expired")
    site.su.execute("UPDATE player.devices SET last_used_at = now(), revoked_at = now()")
    refused("Bearer " + account.token, "token_revoked")


def test_the_sync_routes_count_towards_the_device_tokens_limit(site: Site) -> None:
    account = _account(site)
    pairhelp.settle(site, 60)
    paths = (CHANGES, CURSOR, f"{CLASSES}/{new_uuid()}")
    statuses = [
        account.app.get(paths[n % 3], headers=bearer(account.token)).status_code for n in range(60)
    ]
    assert set(statuses) <= {200, 404}
    over = account.app.get(CHANGES, headers=bearer(account.token))
    assert over.status_code == 429 and over.json() == {"error": "too_many_requests"}
