"""The class library on the site (plan, section 5; ADR 0002, sections 7, 10, 11 and 12): list
the account's classes, read one, delete one, and what a deletion means for the devices and the
source."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from tests import sourcehelp as sh
from tests.pairhelp import app_client, bearer, pair
from tests.sitehelp import Browser, Site

EMAIL = "rider@example.test"
CLASSES = "/api/site/classes"
CHANGES = "/api/player/changes"
PLAYER_CLASSES = "/api/player/classes"
FRESH = "SELECT last_used_at > now() - interval '1 minute' FROM player.sessions"


class Library:
    """A signed-in browser, its account's source token and server, and a paired device."""

    def __init__(self, site: Site) -> None:
        site.allow(EMAIL)
        self.site = site
        self.browser: Browser = site.sign_in(EMAIL)
        self.token = sh.link(site, self.browser)
        self.server = sh.server(site)
        self.app = app_client(site)
        self.device = pair(site, self.browser, "Studio PC", self.app)

    def publish(self, class_id: str, number: int, title: str | None) -> dict[str, Any]:
        doc = None if title is None else sh.document(title)
        answer = sh.publish(self.server, self.token, sh.envelope(class_id, number, doc))
        assert answer.status_code in (200, 409), answer.text
        return dict(answer.json())

    def listed(self, query: str = "") -> dict[str, Any]:
        answer = self.browser.get(CLASSES + query)
        assert answer.status_code == 200, answer.text
        return dict(answer.json())

    def class_id(self, source_class_id: str) -> str:
        for entry in self.listed("?limit=200")["classes"]:
            if entry["source_class_id"] == source_class_id:
                return str(entry["class_id"])
        raise AssertionError(source_class_id)

    def changes(self, after: int = 0) -> dict[str, Any]:
        answer = self.app.get(f"{CHANGES}?after={after}", headers=bearer(self.device))
        assert answer.status_code == 200, answer.text
        return dict(answer.json())


@pytest.fixture
def lib(site: Site) -> Library:
    return Library(site)


def test_an_empty_library_lists_nothing(lib: Library) -> None:
    assert lib.listed() == {"classes": [], "cursor": None, "more": False}


def test_the_list_shows_each_class_and_marker_latest_change_first(lib: Library) -> None:
    lib.publish("warm-up", 1, "Warm up")
    lib.publish("hills", 4, "Hills")
    lib.publish("gone", 2, None)
    body = lib.listed()
    assert body["more"] is False
    listed = [
        (c["source"], c["source_class_id"], c["publication_number"], c["removed"], c["title"])
        for c in body["classes"]
    ]
    assert listed == [
        ("classbeat", "gone", 2, True, None),
        ("classbeat", "hills", 4, False, "Hills"),
        ("classbeat", "warm-up", 1, False, "Warm up"),
    ]
    marker, hills, _ = body["classes"]
    assert marker["length_ms"] is None
    assert hills["length_ms"] == sh.document()["class"]["length_ms"]
    assert set(hills) == {
        "class_id",
        "source",
        "source_class_id",
        "publication_number",
        "removed",
        "title",
        "length_ms",
        "changed_at",
    }
    # No content beyond the title and the length: no hash and no document.
    assert "content_hash" not in str(body) and "intervals" not in str(body)


def test_the_list_is_paged_by_the_cursor_of_each_page(lib: Library) -> None:
    for n in range(1, 6):
        lib.publish(f"c{n}", n, f"Class {n}")
    first = lib.listed("?limit=2")
    assert [c["source_class_id"] for c in first["classes"]] == ["c5", "c4"]
    assert first["more"] is True
    second = lib.listed(f"?limit=2&before={first['cursor']}")
    assert [c["source_class_id"] for c in second["classes"]] == ["c3", "c2"]
    third = lib.listed(f"?limit=2&before={second['cursor']}")
    assert [c["source_class_id"] for c in third["classes"]] == ["c1"]
    assert third["more"] is False
    after_last = lib.listed(f"?limit=2&before={third['cursor']}")
    assert after_last == {"classes": [], "cursor": None, "more": False}


def test_one_class_is_read_with_its_document(lib: Library) -> None:
    lib.publish("hills", 3, "Hills")
    class_id = lib.class_id("hills")
    answer = lib.browser.get(f"{CLASSES}/{class_id}")
    assert answer.status_code == 200
    body = answer.json()
    assert body["document"] == sh.document("Hills")
    assert (body["class_id"], body["source_class_id"], body["publication_number"]) == (
        class_id,
        "hills",
        3,
    )
    assert body["content_hash"] == sh.envelope("hills", 3, sh.document("Hills"))["content_hash"]


def test_an_unknown_class_or_a_marker_is_not_found(lib: Library) -> None:
    lib.publish("gone", 2, None)
    for class_id in (str(uuid.uuid4()), lib.class_id("gone")):
        refused = lib.browser.get(f"{CLASSES}/{class_id}")
        assert refused.status_code == 404 and refused.json() == {"error": "not_found"}


def test_a_deletion_removes_the_content_at_once_and_leaves_a_marker(lib: Library) -> None:
    lib.publish("hills", 3, "Hills")
    lib.publish("keep", 1, "Kept")
    class_id = lib.class_id("hills")
    before = lib.changes()
    assert lib.app.get(f"{PLAYER_CLASSES}/{class_id}", headers=bearer(lib.device)).status_code == (
        200
    )

    assert lib.browser.delete(f"{CLASSES}/{class_id}").status_code == 204

    # The row is the marker: its key and its number, no document, no hash and no title.
    assert sh.class_rows(lib.site, EMAIL) == [
        ("hills", 3, "removal", None, 3),
        ("keep", 1, "class", "Kept", 2),
    ]
    stored = lib.site.su.execute(
        "SELECT document, content_hash FROM player.classes WHERE id = %s", (class_id,)
    ).fetchone()
    assert stored == (None, None)
    # The player API reports the removal with the next sync, and no longer serves the content.
    after = lib.changes(before["cursor"])
    assert [(c["class_id"], c["removed"], c["content_hash"]) for c in after["changes"]] == [
        (class_id, True, None)
    ]
    assert after["cursor"] == before["cursor"] + 1
    gone = lib.app.get(f"{PLAYER_CLASSES}/{class_id}", headers=bearer(lib.device))
    assert gone.status_code == 404 and gone.json() == {"error": "not_found"}
    # The site lists the marker and reads it no more.
    entry = lib.listed()["classes"][0]
    assert (entry["class_id"], entry["removed"], entry["title"], entry["length_ms"]) == (
        class_id,
        True,
        None,
        None,
    )
    assert lib.browser.get(f"{CLASSES}/{class_id}").status_code == 404
    # Section 11: one event, with no title and no content.
    event, detail = lib.site.events(EMAIL)[-1]
    assert event == "class.deleted"
    assert detail == {
        "class_id": class_id,
        "source": "classbeat",
        "source_class_id": "hills",
        "publication_number": 3,
    }


def test_a_deletion_is_idempotent(lib: Library) -> None:
    lib.publish("hills", 3, "Hills")
    lib.publish("gone", 4, None)
    class_id = lib.class_id("hills")
    assert lib.browser.delete(f"{CLASSES}/{class_id}").status_code == 204
    rows, events, cursor = sh.class_rows(lib.site, EMAIL), lib.site.events(EMAIL), lib.changes()
    # Again, and for a class the source removed: 204, and nothing changes.
    for again in (class_id, class_id, lib.class_id("gone")):
        assert lib.browser.delete(f"{CLASSES}/{again}").status_code == 204
    assert sh.class_rows(lib.site, EMAIL) == rows
    assert lib.site.events(EMAIL) == events
    assert lib.changes() == cursor


def test_deleting_a_class_the_account_has_not_is_not_found(lib: Library) -> None:
    refused = lib.browser.delete(f"{CLASSES}/{uuid.uuid4()}")
    assert refused.status_code == 404 and refused.json() == {"error": "not_found"}


def test_after_a_deletion_only_a_higher_number_stores_the_class_again(lib: Library) -> None:
    lib.publish("hills", 3, "Hills")
    class_id = lib.class_id("hills")
    assert lib.browser.delete(f"{CLASSES}/{class_id}").status_code == 204
    # The source still sees its number, now as a removal.
    read = lib.server.get(f"{sh.CLASSES}/hills", headers=sh.bearer(lib.token))
    assert read.json() == {
        "source_class_id": "hills",
        "highest_publication_number": 3,
        "removed": True,
    }
    # A late or repeated send of the content deleted never brings it back.
    assert lib.publish("hills", 2, "Hills")["error"] == "stale_publication"
    assert lib.publish("hills", 3, "Hills")["error"] == "publication_conflict"
    assert lib.browser.get(f"{CLASSES}/{class_id}").status_code == 404
    # A higher number is the user sending it again (ADR 0002, section 7).
    assert lib.publish("hills", 4, "Hills again")["status"] == "applied"
    back = lib.browser.get(f"{CLASSES}/{class_id}")
    assert back.status_code == 200 and back.json()["document"]["class"]["title"] == "Hills again"


def _a_while_ago(site: Site) -> None:
    site.su.execute("UPDATE player.sessions SET last_used_at = now() - interval '6 minutes'")


def test_a_refused_request_keeps_the_sessions_use(lib: Library) -> None:
    for method, path in (
        ("GET", f"{CLASSES}/{uuid.uuid4()}"),
        ("DELETE", f"{CLASSES}/{uuid.uuid4()}"),
    ):
        _a_while_ago(lib.site)
        assert lib.browser.request(method, path).status_code == 404
        assert lib.site.su.execute(FRESH).fetchone() == (True,)


def test_without_a_session_nothing_is_listed_read_or_deleted(lib: Library) -> None:
    lib.publish("hills", 3, "Hills")
    class_id = lib.class_id("hills")
    stranger = lib.site.browser()
    for method, path in (
        ("GET", CLASSES),
        ("GET", f"{CLASSES}/{class_id}"),
        ("DELETE", f"{CLASSES}/{class_id}"),
    ):
        refused = stranger.request(method, path)
        assert refused.status_code == 401 and refused.json() == {"error": "not_signed_in"}
    assert sh.class_rows(lib.site, EMAIL)[0][2] == "class"


def test_a_cross_site_deletion_is_refused_before_the_session(lib: Library) -> None:
    lib.publish("hills", 3, "Hills")
    class_id = lib.class_id("hills")
    _a_while_ago(lib.site)
    refused = lib.browser.delete(f"{CLASSES}/{class_id}", headers={"Origin": "https://evil.test"})
    assert refused.status_code == 403 and refused.json() == {"error": "cross_site_request"}
    assert lib.site.su.execute(FRESH).fetchone() == (False,)
    assert sh.class_rows(lib.site, EMAIL)[0][2] == "class"
