"""What the site's and the player's class answers name (ADR 0002, sections 3 and 7; ADR 0003,
section 6; #115): each answer holds exactly its listed fields. The only id of the source's own
is `source_class_id`, the source's id for the class, which those ADRs and the player API's
schema give the account's own site and devices. No answer carries an id of the backend's rows
other than the class's own: not the account's, the source link's or the device's."""

from __future__ import annotations

from typing import Any

from tests import sourcehelp as sh
from tests.pairhelp import app_client, bearer, pair
from tests.sitehelp import Site

EMAIL = "rider@example.test"
SOURCE_CLASS_ID = "source-own-id-41"

LISTED = {
    "class_id",
    "source",
    "source_class_id",
    "publication_number",
    "removed",
    "title",
    "length_ms",
    "changed_at",
}
READ = {
    "class_id",
    "source",
    "source_class_id",
    "publication_number",
    "content_hash",
    "changed_at",
    "document",
}
CHANGE = {
    "class_id",
    "source",
    "source_class_id",
    "publication_number",
    "removed",
    "content_hash",
    "published_at",
    "position",
}
HELD = {
    "class_id",
    "source",
    "source_class_id",
    "publication_number",
    "content_hash",
    "position",
    "document",
}


def _ids(site: Site) -> list[str]:
    """Every id of the backend's own rows for the account but its classes'."""
    found: list[str] = []
    for statement in (
        "SELECT id::text FROM player.accounts",
        "SELECT id::text FROM player.source_links",
        "SELECT id::text FROM player.devices",
        "SELECT id::text FROM player.sessions",
        "SELECT encode(passkey_user_handle, 'hex') FROM player.accounts",
    ):
        found.extend(str(row[0]) for row in site.su.execute(statement).fetchall())
    return found


def test_class_answers_hold_their_fields_and_no_other_id(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL, site.browser("198.51.100.1"))
    app = app_client(site, "198.51.100.1")
    device = pair(site, browser, "Studio PC", app)
    server = sh.server(site, "192.0.2.30")
    token = sh.link(site, browser)
    for class_id, doc in ((SOURCE_CLASS_ID, sh.document("Kept")), ("gone", None)):
        answer = sh.publish(server, token, sh.envelope(class_id, 1, doc))
        assert answer.status_code == 200

    bodies: list[dict[str, Any]] = []
    listed = browser.get("/api/site/classes").json()
    bodies.append(listed)
    entries: list[dict[str, Any]] = listed["classes"]
    assert [set(entry) for entry in entries] == [LISTED, LISTED]
    kept = next(e for e in entries if e["source_class_id"] == SOURCE_CLASS_ID)
    read = browser.get(f"/api/site/classes/{kept['class_id']}").json()
    assert set(read) == READ
    bodies.append(read)

    changes = app.get("/api/player/changes", headers=bearer(device)).json()
    assert set(changes) == {"changes", "cursor", "more"}
    assert [set(change) for change in changes["changes"]] == [CHANGE, CHANGE]
    held = app.get(f"/api/player/classes/{kept['class_id']}", headers=bearer(device)).json()
    assert set(held) == HELD
    bodies.extend((changes, held))

    # The source's id is given as itself, under its own name, and nowhere else.
    for body in (read, held):
        assert body["source_class_id"] == SOURCE_CLASS_ID
        assert SOURCE_CLASS_ID not in str({k: v for k, v in body.items() if k != "source_class_id"})
    text = " ".join(str(body) for body in bodies)
    own_ids = _ids(site)
    # The account, its handle, one link, one device, and at least one session.
    assert len(own_ids) >= 5
    for own_id in own_ids:
        assert own_id not in text
