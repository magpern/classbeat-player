"""Publications into the class library (ADR 0002, section 7; ADR 0003, section 6; plan,
section 5), through the real routes: the table of outcomes, removals and their markers, the
sync cursor, the content hash, the limits, and the numbers a source may read back."""

from __future__ import annotations

import json

import pytest

from player_backend.token_issue import new_token
from tests import sourcehelp as sh
from tests.pairhelp import settle
from tests.sitehelp import Browser, Site

EMAIL = "teacher@example.test"


@pytest.fixture
def linked(site: Site) -> tuple[Browser, str]:
    """The source's server and its token for the account."""
    site.allow(EMAIL)
    token = sh.link(site, site.sign_in(EMAIL))
    return sh.server(site), token


def _events(site: Site) -> list[str]:
    return [e for e, _ in site.events(EMAIL) if e.startswith("publication.")]


def test_a_first_publication_is_applied_and_stored_with_its_hash(
    site: Site, linked: tuple[Browser, str]
) -> None:
    app, token = linked
    doc = sh.document("Monday")
    answer = sh.publish(app, token, sh.envelope("c1", 1, doc))
    assert answer.status_code == 200
    assert answer.json() == {"status": "applied", "highest_publication_number": 1}
    assert answer.headers["cache-control"] == "no-store"
    assert sh.class_rows(site, EMAIL) == [("c1", 1, "class", "Monday", 1)]
    stored = site.su.execute("SELECT content_hash, source_id FROM player.classes").fetchone()
    assert stored == (sh.envelope("c1", 1, doc)["content_hash"], "classbeat")
    assert _events(site) == ["publication.applied"]


def test_the_table_of_outcomes(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    first, other = sh.document("First"), sh.document("Other")
    assert sh.publish(app, token, sh.envelope("c1", 5, first)).json()["status"] == "applied"
    # Equal, same kind and hash: a repeat, nothing changes.
    repeat = sh.publish(app, token, sh.envelope("c1", 5, first))
    assert repeat.status_code == 200 and repeat.json()["status"] == "repeat"
    # Equal, other hash or other kind: a conflict.
    for body in (sh.envelope("c1", 5, other), sh.envelope("c1", 5, None)):
        conflict = sh.publish(app, token, body)
        assert conflict.status_code == 409
        assert conflict.json() == {"error": "publication_conflict", "highest_publication_number": 5}
    # Lower: stale, with the highest number seen.
    stale = sh.publish(app, token, sh.envelope("c1", 4, other))
    assert stale.status_code == 409
    assert stale.json() == {"error": "stale_publication", "highest_publication_number": 5}
    # Higher: applied.
    assert sh.publish(app, token, sh.envelope("c1", 6, other)).json()["status"] == "applied"
    assert sh.class_rows(site, EMAIL) == [("c1", 6, "class", "Other", 2)]
    assert _events(site) == [
        "publication.applied",
        "publication.conflict",
        "publication.conflict",
        "publication.stale",
        "publication.applied",
    ]


def test_a_removal_leaves_a_marker_that_a_late_older_send_cannot_undo(
    site: Site, linked: tuple[Browser, str]
) -> None:
    app, token = linked
    doc = sh.document("Secret title")
    assert sh.publish(app, token, sh.envelope("c1", 1, doc)).status_code == 200
    removed = sh.publish(app, token, sh.envelope("c1", 2, None))
    assert removed.json() == {"status": "applied", "highest_publication_number": 2}
    # The marker: the class's own row without its document, no title, no hash.
    marker = site.su.execute(
        "SELECT publication_number, kind, content_hash, document, published_at IS NOT NULL "
        "FROM player.classes"
    ).fetchone()
    assert marker == (2, "removal", None, None, True)
    assert "Secret title" not in json.dumps(site.events(EMAIL))
    # A repeat of the removal is a repeat; the late older send is stale.
    assert sh.publish(app, token, sh.envelope("c1", 2, None)).json()["status"] == "repeat"
    late = sh.publish(app, token, sh.envelope("c1", 1, doc))
    assert late.status_code == 409 and late.json()["error"] == "stale_publication"
    assert sh.class_rows(site, EMAIL) == [("c1", 2, "removal", None, 2)]
    # A later, higher-numbered send stores the class again.
    assert sh.publish(app, token, sh.envelope("c1", 3, doc)).json()["status"] == "applied"
    assert sh.class_rows(site, EMAIL) == [("c1", 3, "class", "Secret title", 3)]


def test_a_removal_of_a_class_never_sent_leaves_a_marker(
    site: Site, linked: tuple[Browser, str]
) -> None:
    app, token = linked
    assert sh.publish(app, token, sh.envelope("gone", 7, None)).json()["status"] == "applied"
    assert sh.class_rows(site, EMAIL) == [("gone", 7, "removal", None, 1)]
    stale = sh.publish(app, token, sh.envelope("gone", 3, sh.document()))
    assert stale.status_code == 409


def test_a_refused_first_publication_commits_no_placeholder(
    site: Site, linked: tuple[Browser, str]
) -> None:
    app, token = linked
    # Invalid, so refused after the token was entered: nothing of the class is written.
    bad = sh.envelope("c1", 1, sh.document())
    bad["content_hash"] = "sha256:" + "0" * 64
    counters = "SELECT coalesce(sum(hits), 0) FROM player.rate_limits"
    before = site.su.execute(counters).fetchone()
    assert before is not None
    assert sh.publish(app, token, bad).status_code == 422
    assert site.su.execute("SELECT count(*) FROM player.classes").fetchone() == (0,)
    assert site.su.execute("SELECT count(*) FROM player.account_sync").fetchone() == (0,)
    # The request was counted and the link used all the same.
    assert site.su.execute(counters).fetchone() == (int(str(before[0])) + 1,)
    used = site.su.execute("SELECT last_used_at IS NOT NULL FROM player.source_links")
    assert used.fetchone() == (True,)


def test_the_sync_cursor_moves_once_per_applied_publication(
    site: Site, linked: tuple[Browser, str]
) -> None:
    app, token = linked
    for class_id, number in (("a", 1), ("b", 1), ("a", 2), ("a", 2), ("a", 1)):
        sh.publish(app, token, sh.envelope(class_id, number, sh.document(class_id)))
    assert site.su.execute("SELECT position - base FROM player.account_sync").fetchone() == (3,)
    assert [(r[0], r[4]) for r in sh.class_rows(site, EMAIL)] == [("a", 3), ("b", 2)]


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"content_hash": "sha256:" + "1" * 64}, "content_hash_mismatch"),
        ({"publication_number": 0}, "invalid_publication"),
        ({"publication_number": 2**63}, "invalid_publication"),
        ({"publication_number": True}, "invalid_publication"),
        ({"publication_number": 1.0}, "invalid_publication"),
        ({"source_class_id": ""}, "invalid_publication"),
        ({"source_class_id": "x" * 101}, "invalid_publication"),
        ({"removed": True}, "invalid_publication"),
        ({"source_id": "other"}, "invalid_publication"),
        ({"source_class_id": "c\x00"}, "invalid_publication"),
        ({"document": {"format_version": "1.0"}}, "invalid_publication"),
    ],
)
def test_an_invalid_publication_is_refused(
    site: Site, linked: tuple[Browser, str], change: dict[str, object], code: str
) -> None:
    app, token = linked
    body = {**sh.envelope("c1", 1, sh.document()), **change}
    answer = sh.publish(app, token, body)
    assert answer.status_code == 422 and answer.json() == {"error": code}
    assert site.su.execute("SELECT count(*) FROM player.classes").fetchone() == (0,)


def test_the_largest_number_is_accepted(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    answer = sh.publish(app, token, sh.envelope("c1", 2**63 - 1, sh.document()))
    assert answer.status_code == 200


def test_an_unknown_major_is_refused(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    doc = {**sh.document(), "format_version": "2.0"}
    answer = sh.publish(app, token, sh.envelope("c1", 1, doc))
    assert answer.status_code == 422 and answer.json() == {"error": "unsupported_format_version"}


def test_a_document_over_one_mebibyte_is_refused(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    doc = sh.document()
    doc["intervals"][0]["cue"] = "x" * (1024 * 1024)
    answer = sh.publish(app, token, sh.envelope("c1", 1, doc))
    assert answer.status_code == 413 and answer.json() == {"error": "document_too_large"}
    huge = app.post(sh.PUBLICATIONS, content=b" " * (2 * 1024 * 1024 + 1), headers=sh.bearer(token))
    assert huge.status_code == 413


def test_the_source_id_is_the_tokens(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    sh.publish(app, token, sh.envelope("c1", 1, sh.document()))
    assert site.su.execute("SELECT DISTINCT source_id FROM player.classes").fetchall() == [
        ("classbeat",)
    ]


def test_a_source_reads_its_numbers_and_nothing_else(
    site: Site, linked: tuple[Browser, str]
) -> None:
    app, token = linked
    sh.publish(app, token, sh.envelope("c1", 4, sh.document("Title")))
    read = app.get(f"{sh.CLASSES}/c1", headers=sh.bearer(token))
    assert read.status_code == 200
    assert read.json() == {
        "source_class_id": "c1",
        "highest_publication_number": 4,
        "removed": False,
    }
    sh.publish(app, token, sh.envelope("c1", 5, None))
    assert app.get(f"{sh.CLASSES}/c1", headers=sh.bearer(token)).json()["removed"] is True
    assert app.get(f"{sh.CLASSES}/nope", headers=sh.bearer(token)).status_code == 404


def test_a_nul_in_a_document_string_is_refused(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    doc = sh.document()
    doc["intervals"][0]["cue"] = "a\x00b"
    answer = sh.publish(app, token, sh.envelope("c1", 1, doc))
    assert answer.status_code == 422 and answer.json() == {"error": "invalid_publication"}
    assert site.su.execute("SELECT count(*) FROM player.classes").fetchone() == (0,)


def test_a_nul_in_a_document_key_is_refused(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    # A newer minor's field this backend does not know is kept, so its key would reach storage.
    doc = {**sh.document(), "format_version": "1.7", "later_field": {"x\x00": 1}}
    answer = sh.publish(app, token, sh.envelope("c1", 1, doc))
    assert answer.status_code == 422 and answer.json() == {"error": "invalid_publication"}
    assert site.su.execute("SELECT count(*) FROM player.classes").fetchone() == (0,)


def test_a_source_never_reads_another_sources_numbers(
    site: Site, linked: tuple[Browser, str]
) -> None:
    app, token = linked
    sh.publish(app, token, sh.envelope("seed", 1, sh.document()))
    # The same class id from another source in the same account.
    site.su.execute(
        "INSERT INTO player.classes (account_id, source_id, source_class_id, publication_number, "
        "kind, content_hash, published_at, sync_position, document) "
        "SELECT account_id, 'other', 'c1', 9, 'class', content_hash, now(), 1, document "
        "FROM player.classes WHERE source_class_id = 'seed'"
    )
    assert app.get(f"{sh.CLASSES}/c1", headers=sh.bearer(token)).status_code == 404
    sh.publish(app, token, sh.envelope("c1", 2, sh.document()))
    read = app.get(f"{sh.CLASSES}/c1", headers=sh.bearer(token))
    assert read.json()["highest_publication_number"] == 2


def test_at_most_2000_classes_per_account(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    sh.publish(app, token, sh.envelope("seed", 1, sh.document()))
    site.su.execute(
        "INSERT INTO player.classes (account_id, source_id, source_class_id, publication_number, "
        "kind, content_hash, published_at, sync_position, document) "
        "SELECT c.account_id, 'classbeat', 'bulk-' || n, 1, 'class', c.content_hash, now(), "
        "n, c.document FROM player.classes c, generate_series(1, 1999) n"
    )
    cursor = "SELECT position FROM player.account_sync"
    before = site.su.execute(cursor).fetchone()
    full = sh.publish(app, token, sh.envelope("one-more", 1, sh.document()))
    assert full.status_code == 409 and full.json()["error"] == "too_many_classes"
    # The refusal is undone to its savepoint: no placeholder row, and the cursor stays.
    held = "SELECT count(*) FROM player.classes WHERE source_class_id = 'one-more'"
    assert site.su.execute(held).fetchone() == (0,)
    assert site.su.execute(cursor).fetchone() == before
    # A class that is already held may still change, and a removal makes room.
    assert sh.publish(app, token, sh.envelope("seed", 2, sh.document("New"))).status_code == 200
    assert sh.publish(app, token, sh.envelope("bulk-1", 2, None)).status_code == 200
    assert sh.publish(app, token, sh.envelope("one-more", 1, sh.document())).status_code == 200
    assert "publication.refused" in _events(site)


def test_publications_are_limited_per_token(site: Site, linked: tuple[Browser, str]) -> None:
    app, token = linked
    settle(site, 60, margin=10.0)
    for number in range(1, 61):
        assert sh.publish(app, token, sh.envelope("c1", number, None)).status_code == 200
    limited = sh.publish(app, token, sh.envelope("c1", 99, None))
    assert limited.status_code == 429 and int(limited.headers["retry-after"]) >= 1
    assert sh.class_rows(site, EMAIL)[0][1] == 60


def test_every_request_with_a_source_token_counts_under_the_one_limit(
    site: Site, linked: tuple[Browser, str]
) -> None:
    # Not publications alone (source_policy.py): number reads and their refusals count too.
    app, token = linked
    settle(site, 60, margin=10.0)
    for number in range(1, 31):
        assert sh.publish(app, token, sh.envelope("c1", number, None)).status_code == 200
    for n in range(30):
        path = f"{sh.CLASSES}/c1" if n % 2 else f"{sh.CLASSES}/nope"
        assert app.get(path, headers=sh.bearer(token)).status_code in (200, 404)
    assert sh.publish(app, token, sh.envelope("c1", 99, None)).status_code == 429
    assert app.get(f"{sh.CLASSES}/c1", headers=sh.bearer(token)).status_code == 429
    # Ending the link is a request of the token as well: refused, and the link stays.
    assert app.delete(sh.OWN_LINK, headers=sh.bearer(token)).status_code == 429
    assert site.su.execute("SELECT count(*) FROM player.source_links").fetchone() == (1,)


def test_a_token_of_another_type_is_refused_before_any_lookup(
    site: Site, linked: tuple[Browser, str]
) -> None:
    app, _ = linked
    site.su.execute("DELETE FROM player.rate_limits")
    for header in (
        {},
        {"Authorization": "Basic x"},
        sh.bearer(new_token("dev")),
        sh.bearer(new_token("ses")),
        sh.bearer("cbp_src_short"),
    ):
        answer = app.post(sh.PUBLICATIONS, json=sh.envelope("c1", 1, None), headers=header)
        assert answer.status_code == 401 and answer.json() == {"error": "invalid_token"}
    assert site.su.execute("SELECT count(*) FROM player.rate_limits").fetchone() == (0,)
    unknown = sh.publish(app, new_token("src"), sh.envelope("c1", 1, None))
    assert unknown.status_code == 401 and unknown.json() == {"error": "token_unknown"}
