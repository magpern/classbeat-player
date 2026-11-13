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


def _base(site: Site, email: str = EMAIL) -> int:
    """Where the account's sync order starts (sync_policy.py): its first change is at base + 1."""
    row = site.su.execute(
        "SELECT y.base FROM player.account_sync y JOIN player.accounts a ON a.id = y.account_id "
        "WHERE a.email = %s",
        (email,),
    ).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


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
    base = _base(site)
    body = account.get(CHANGES)
    assert body["cursor"] == base + 2 and body["more"] is False
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
    assert (first["source"], first["source_class_id"], first["position"]) == (
        "classbeat",
        "one",
        base + 1,
    )
    assert first["content_hash"] == content_hash(sh.document("First"))
    assert (second["source_class_id"], second["publication_number"], second["position"]) == (
        "two",
        5,
        base + 2,
    )
    # No content in a change: not the title, not the document.
    assert "First" not in str(changes) and "document" not in str(changes)
    assert account.get(CURSOR) == {"cursor": base + 2}


def test_a_removal_after_a_class_is_one_change_with_no_hash(site: Site) -> None:
    account = _account(site)
    account.publish("gone", 1, "Soon gone")
    account.publish("kept", 1, "Kept")
    base = _base(site)
    first: list[dict[str, Any]] = account.get(CHANGES)["changes"]
    gone_id = next(c["class_id"] for c in first if c["source_class_id"] == "gone")
    assert account.get(f"{CLASSES}/{gone_id}")["document"] is not None
    account.publish("gone", 2, None)
    # The class's row moved to the end of the order as a removal: one change, not two.
    assert _changes(account) == [("kept", 1, False), ("gone", 2, True)]
    after_kept = account.get(f"{CHANGES}?after={base + 2}")
    assert after_kept["cursor"] == base + 3
    changes: list[dict[str, Any]] = after_kept["changes"]
    assert len(changes) == 1
    removal = changes[0]
    assert removal["class_id"] == gone_id and removal["removed"] is True
    assert removal["content_hash"] is None and removal["position"] == base + 3
    # The marker holds no document: the class is not found any more.
    refused = account.app.get(f"{CLASSES}/{gone_id}", headers=bearer(account.token))
    assert refused.status_code == 404 and refused.json() == {"error": "not_found"}
    # Sent again with a higher number, it is a class again, at a new place.
    account.publish("gone", 3, "Back")
    assert _changes(account, f"?after={base + 3}") == [("gone", 3, False)]
    assert account.get(f"{CLASSES}/{gone_id}")["publication_number"] == 3


def test_changes_come_in_pages_with_a_limit(site: Site) -> None:
    account = _account(site)
    for n in range(1, 6):
        account.publish(f"c{n}", n, f"Class {n}")
    base = _base(site)
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
    assert (pages, cursor) == (3, base + 5)
    # A page that ends exactly at the last change says so.
    assert account.get(f"{CHANGES}?after={base + 3}&limit=2")["more"] is False
    assert account.get(f"{CHANGES}?after={base + 2}&limit=2")["more"] is True
    # The current cursor is an empty page.
    current: dict[str, object] = {"changes": [], "cursor": base + 5, "more": False}
    assert account.get(f"{CHANGES}?after={base + 5}") == current
    assert len(account.get(f"{CHANGES}?limit=500")["changes"]) == 5


# Refused by the routes themselves (sync_policy.py), never by the framework: each is the
# device token's use all the same (ADR 0002, section 10).
MALFORMED = (
    f"{CHANGES}?limit=0",
    f"{CHANGES}?limit=501",
    f"{CHANGES}?limit=-1",
    f"{CHANGES}?after=-1",
    f"{CHANGES}?after=9223372036854775808",
    f"{CHANGES}?after=99999999999999999999999",
    f"{CHANGES}?after=x",
    f"{CHANGES}?after=",
    f"{CHANGES}?after=+1",
    f"{CHANGES}?after=%201",
    f"{CHANGES}?after=1_0",
    f"{CHANGES}?after=%D9%A3",  # an Arabic-Indic digit, which `int` would take
    f"{CHANGES}?limit=1.5",
    f"{CLASSES}/not-an-id",
    f"{CLASSES}/11111111111141118111111111111111",
    f"{CLASSES}/%7B11111111-1111-4111-8111-111111111111%7D",
    f"{CLASSES}/urn:uuid:11111111-1111-4111-8111-111111111111",
)


@pytest.mark.parametrize("path", MALFORMED)
def test_a_malformed_cursor_limit_or_class_id_is_refused(site: Site, path: str) -> None:
    account = _account(site)
    answer = account.app.get(path, headers=bearer(account.token))
    assert answer.status_code == 422 and answer.json() == {"error": "invalid_request"}
    # Counted as the token's use: "last used" is written, the request is not undone.
    assert pairhelp.device_rows(site, EMAIL) == [("Studio PC", True, False)]


def test_a_cursor_from_another_account_is_refused_with_a_resync(site: Site) -> None:
    mine = _account(site)
    other = _account(site, OTHER, "198.51.100.2")
    their_cursors: list[int] = []
    for n in range(1, 5):
        other.publish(f"theirs-{n}", n, "Theirs")
        their_cursors.append(other.get(CURSOR)["cursor"])
    for n in range(1, 6):
        mine.publish(f"mine-{n}", n, "Mine")
    base, their_base = _base(site), _base(site, OTHER)
    # Each account's order starts at its own random base, so their places do not meet.
    assert base != their_base and their_cursors == [their_base + n for n in range(1, 5)]
    assert mine.get(CURSOR) == {"cursor": base + 5}
    # Every cursor the other account was given is refused for this account's device token,
    # however its number compares with this account's own (#115): the device resyncs in full.
    for their_cursor in their_cursors:
        refused = mine.app.get(f"{CHANGES}?after={their_cursor}", headers=bearer(mine.token))
        assert refused.status_code == 409
        assert refused.json() == {"error": "resync_required", "cursor": base + 5}
        assert "theirs" not in refused.text
    # So is a place below this account's base, and one above its current cursor.
    for never in (1, base - 1, base + 6):
        refused = mine.app.get(f"{CHANGES}?after={never}", headers=bearer(mine.token))
        assert refused.status_code == 409 and refused.json()["error"] == "resync_required"
    # Its own cursors read this account's rows, and never the other's.
    assert len(_changes(mine, "?after=0")) == 5
    assert _changes(mine, f"?after={base}") == _changes(mine, "?after=0")
    assert _changes(mine, f"?after={base + 4}") == [("mine-5", 5, False)]
    assert _changes(mine, f"?after={base + 5}") == []
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
    assert (body["source_class_id"], body["publication_number"], body["position"]) == (
        "one",
        7,
        _base(site) + 1,
    )
    unknown = account.app.get(
        f"{CLASSES}/00000000-0000-4000-8000-000000000000", headers=bearer(account.token)
    )
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
    # The canonical form only, in either case.
    upper = account.get(f"{CLASSES}/{str(change['class_id']).upper()}")
    assert upper["class_id"] == change["class_id"]


def test_sync_writes_nothing_but_the_device_tokens_own_use(site: Site) -> None:
    account = _account(site)
    account.publish("one", 1, "One")
    account.publish("two", 1, None)
    class_id = account.get(CHANGES)["changes"][0]["class_id"]
    before = _stored(site)
    own = f"{CHANGES}?after={_base(site) + 1}&limit=1"
    for path in (CHANGES, own, CURSOR, f"{CLASSES}/{class_id}"):
        account.get(path)
    for refused in (f"{CHANGES}?after=99", f"{CLASSES}/{new_uuid()}", *MALFORMED):
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
    # Pages and the cursor share the 60; a document read has a budget of its own
    # (tests/test_document_budget.py).
    paths = (CHANGES, CURSOR)
    statuses = [
        account.app.get(paths[n % 2], headers=bearer(account.token)).status_code for n in range(60)
    ]
    assert set(statuses) == {200}
    for path in paths:
        over = account.app.get(path, headers=bearer(account.token))
        assert over.status_code == 429 and over.json() == {"error": "too_many_requests"}
    read = account.app.get(f"{CLASSES}/{new_uuid()}", headers=bearer(account.token))
    assert read.status_code == 404


def test_malformed_requests_count_towards_the_device_tokens_limit(site: Site) -> None:
    account = _account(site)
    pairhelp.settle(site, 60)
    # The malformed pages here; malformed class ids count towards the document reads' budget
    # (tests/test_document_budget.py).
    pages = [path for path in MALFORMED if path.startswith(CHANGES)]
    statuses = [
        account.app.get(pages[n % len(pages)], headers=bearer(account.token)).status_code
        for n in range(60)
    ]
    assert set(statuses) == {422}
    for path in (CHANGES, MALFORMED[0]):
        over = account.app.get(path, headers=bearer(account.token))
        assert over.status_code == 429 and over.json() == {"error": "too_many_requests"}
