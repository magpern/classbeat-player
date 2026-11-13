"""The account's export (ADR 0002, sections 10, 11 and 12): only the caller's own data, no
secret material, a recent sign-in, and 3 a day per account."""

from __future__ import annotations

from typing import Any, LiteralString, cast
from uuid import UUID

from tests.accounthelp import EXPORT, Held, full_account, secret_values, spellings
from tests.pairhelp import settle
from tests.sitehelp import ORIGIN, Site

A = "a@example.test"
B = "b@example.test"
EXPORTED = "account.exported"


def _two(site: Site) -> tuple[Held, Held]:
    return (
        full_account(site, A, "198.51.100.1", "192.0.2.21"),
        full_account(site, B, "198.51.100.2", "192.0.2.22"),
    )


def _keys(value: object) -> set[str]:
    """Every key of every object in a JSON value, at any depth."""
    found: set[str] = set()
    if isinstance(value, dict):
        for key, inner in cast("dict[str, object]", value).items():
            found |= {key, *_keys(inner)}
    elif isinstance(value, list):
        for inner in cast("list[object]", value):
            found |= _keys(inner)
    return found


# The rows of each part of the export, as the tests' own connection counts them.
COUNTS: dict[str, LiteralString] = {
    "devices": "SELECT count(*)::int FROM player.devices WHERE account_id = %s",
    "source_links": "SELECT count(*)::int FROM player.source_links WHERE account_id = %s",
    "sessions": "SELECT count(*)::int FROM player.sessions WHERE account_id = %s",
    "passkeys": "SELECT count(*)::int FROM player.passkeys WHERE account_id = %s",
    "audit_events": "SELECT count(*)::int FROM player.audit_events WHERE account_id = %s",
    "classes": "SELECT count(*)::int FROM player.classes "
    "WHERE account_id = %s AND publication_number > 0",
}


def _count(site: Site, part: str, account_id: UUID) -> int:
    row = site.su.execute(COUNTS[part], (account_id,)).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


def test_the_export_holds_the_callers_data_only_and_no_secret(site: Site) -> None:
    a, b = _two(site)
    answer = a.browser.post(EXPORT)
    assert answer.status_code == 200
    assert answer.headers["cache-control"] == "no-store"
    assert answer.headers["content-disposition"].startswith("attachment;")
    body: dict[str, Any] = answer.json()
    text = answer.text

    assert body["format"] == 1
    assert body["account"] == {"email": A, "created_at": body["account"]["created_at"]}
    # Every part holds every row of A's, and only A's.
    for part in COUNTS:
        assert len(body[part]) == _count(site, part, a.account_id), part
    assert [d["name"] for d in body["devices"]] == ["a PC"]
    assert [link["source"] for link in body["source_links"]] == ["classbeat"]
    assert [p["name"] for p in body["passkeys"]] == ["Laptop key"]
    assert sorted(
        (c["source_class_id"], c["publication_number"], c["removed"]) for c in body["classes"]
    ) == [("kept", 1, False), ("removed", 2, True)]
    kept = next(c for c in body["classes"] if c["source_class_id"] == "kept")
    assert kept["document"]["class"]["title"] == "Class of " + A
    assert next(c for c in body["classes"] if c["removed"])["document"] is None
    assert [s["current"] for s in body["sessions"]].count(True) == 1
    # The export's own event is in it.
    assert body["audit_events"][-1]["event"] == EXPORTED

    # Nothing of B's: its email, its titles, its devices and links and sessions by id.
    assert B not in text and "Class of " + B not in text and "b PC" not in text
    for statement in (
        "SELECT id::text FROM player.devices WHERE account_id = %s",
        "SELECT id::text FROM player.source_links WHERE account_id = %s",
        "SELECT id::text FROM player.sessions WHERE account_id = %s",
        "SELECT id::text FROM player.classes WHERE account_id = %s",
        "SELECT id::text FROM player.audit_events WHERE account_id = %s",
    ):
        for (other_id,) in site.su.execute(statement, (b.account_id,)).fetchall():
            assert str(other_id) not in text

    # No secret material of either account: no token, hash, key, handle or account id.
    for held in (a, b):
        for token in (held.device_token, held.source_token, *held.session_tokens):
            assert token not in text and token.split("_", 2)[2] not in text
        assert str(held.account_id) not in text and held.account_id.hex not in text
    for value in secret_values(site):
        for spelling in spellings(value):
            assert spelling not in text
    named = _keys(body)
    assert not {k for k in named if "hash" in k or "token" in k or "handle" in k or "_key" in k}


def test_the_export_writes_its_event_and_changes_nothing_else(site: Site) -> None:
    a, _ = _two(site)
    before = site.events(A)
    assert a.browser.post(EXPORT).status_code == 200
    after = site.events(A)
    assert after[: len(before)] == before and after[len(before) :] == [(EXPORTED, {})]


def test_the_export_needs_a_recent_sign_in(site: Site) -> None:
    a, _ = _two(site)
    site.su.execute("UPDATE player.sessions SET signed_in_at = now() - interval '11 minutes'")
    before = site.events(A)
    answer = a.browser.post(EXPORT)
    assert answer.status_code == 403 and answer.json() == {"error": "recent_sign_in_required"}
    assert site.events(A) == before
    # Not counted either: three exports go through after a fresh sign-in.
    fresh = site.sign_in(A, site.browser("198.51.100.1"))
    settle(site, 86400)
    for _ in range(3):
        assert fresh.post(EXPORT).status_code == 200


def test_the_export_is_refused_without_a_session_or_across_sites(site: Site) -> None:
    a, _ = _two(site)
    assert site.first.post(EXPORT).json() == {"error": "not_signed_in"}
    cross = a.browser.post(EXPORT, headers={"Origin": "https://evil.test"})
    assert cross.status_code == 403 and cross.json() == {"error": "cross_site_request"}
    fetched = a.browser.post(EXPORT, headers={"Origin": ORIGIN, "Sec-Fetch-Site": "cross-site"})
    assert fetched.status_code == 403
    # A read is not an export.
    assert a.browser.get(EXPORT).status_code == 405
    assert [e for e, _ in site.events(A)].count(EXPORTED) == 0


def test_three_exports_a_day_per_account(site: Site) -> None:
    a, b = _two(site)
    settle(site, 86400)
    for _ in range(3):
        assert a.browser.post(EXPORT).status_code == 200
    # Another session of the same account shares the count.
    limited = a.other.post(EXPORT)
    assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    assert 1 <= int(limited.headers["retry-after"]) <= 86400
    assert [e for e, _ in site.events(A)].count(EXPORTED) == 3
    # The count is the account's: B exports all the same.
    assert b.browser.post(EXPORT).status_code == 200
