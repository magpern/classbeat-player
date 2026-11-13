"""Deleting the account (ADR 0002, section 12; the owner-visible default in docs/owner.md):
everything at once, removal markers and audit events included, every token refused after it,
and another account untouched."""

from __future__ import annotations

from psycopg import sql

from tests import pairhelp
from tests import sourcehelp as sh
from tests.accounthelp import DELETE, Held, full_account, owned_tables
from tests.pairhelp import DEVICE, bearer, poll
from tests.sitehelp import SESSION_COOKIE, Site

A = "a@example.test"
B = "b@example.test"
# Every table an account can own a row in. The deletion test reads the catalogue for the
# tables that have an owner column; this list only makes sure the test is not looking at less.
KNOWN = {
    "accounts",
    "sessions",
    "passkeys",
    "passkey_registrations",
    "devices",
    "source_links",
    "classes",
    "account_sync",
    "audit_events",
    "pairings",
    "source_link_codes",
}


def _two(site: Site) -> tuple[Held, Held]:
    return (
        full_account(site, A, "198.51.100.1", "192.0.2.21"),
        full_account(site, B, "198.51.100.2", "192.0.2.22"),
    )


def _rows(site: Site, held: Held) -> dict[str, list[tuple[object, ...]]]:
    """Every row of the account, table by table, in every table with an owner column."""
    found: dict[str, list[tuple[object, ...]]] = {}
    for table, column in owned_tables(site):
        statement = sql.SQL("SELECT t::text FROM player.{} t WHERE {} = %s ORDER BY 1").format(
            sql.Identifier(table), sql.Identifier(column)
        )
        found[table] = site.su.execute(statement, (held.account_id,)).fetchall()
    return found


def test_deleting_the_account_removes_every_row_it_owns_and_nothing_else(site: Site) -> None:
    a, b = _two(site)
    assert {table for table, _ in owned_tables(site)} >= KNOWN
    before_a, before_b = _rows(site, a), _rows(site, b)
    # A really owns a row in every one of them, so that the check below means something.
    assert all(before_a[table] for table in KNOWN), {t for t in KNOWN if not before_a[t]}
    answer = a.browser.post(DELETE, json={"confirm": A})
    assert answer.status_code == 204
    assert SESSION_COOKIE in answer.headers["set-cookie"]
    assert "Max-Age=0" in answer.headers["set-cookie"]
    assert all(not rows for rows in _rows(site, a).values()), _rows(site, a)
    # Removal markers and audit events too: the account leaves no row at all.
    assert site.su.execute(
        "SELECT count(*) FROM player.audit_events WHERE account_id = %s", (a.account_id,)
    ).fetchone() == (0,)
    assert _rows(site, b) == before_b


def test_after_the_deletion_every_token_of_the_account_is_refused(site: Site) -> None:
    a, b = _two(site)
    assert a.browser.post(DELETE, json={"confirm": A}).status_code == 204
    # Its sessions, the one that deleted and the other one.
    assert a.browser.get("/api/site/sessions").json() == {"error": "not_signed_in"}
    for token in a.session_tokens:
        stolen = site.browser("198.51.100.1")
        stolen.cookies.set(SESSION_COOKIE, token, domain="player.test")
        assert stolen.get("/api/site/sessions").status_code == 401
    assert a.other.get("/api/site/sessions").status_code == 401
    # Its device: unknown, which the app answers by forgetting the token (it is "gone").
    refused = a.app.get(DEVICE, headers=bearer(a.device_token))
    assert refused.status_code == 401 and refused.json() == {"error": "token_unknown"}
    synced = a.app.get("/api/player/changes", headers=bearer(a.device_token))
    assert synced.status_code == 401 and synced.json() == {"error": "token_unknown"}
    # Its source link.
    published = sh.publish(a.server, a.source_token, sh.envelope("kept", 3, sh.document()))
    assert published.status_code == 401 and published.json() == {"error": "token_unknown"}
    # B's tokens all still work.
    assert b.browser.get("/api/site/sessions").status_code == 200
    assert b.other.get("/api/site/sessions").status_code == 200
    assert b.app.get(DEVICE, headers=bearer(b.device_token)).status_code == 200
    read = b.server.get(f"{sh.CLASSES}/kept", headers=sh.bearer(b.source_token))
    assert read.status_code == 200 and read.json()["highest_publication_number"] == 1


def test_a_pairing_approved_before_the_deletion_gives_no_token(site: Site) -> None:
    site.allow(A)
    browser = site.sign_in(A)
    pairing = pairhelp.start(site)
    assert pairhelp.approve(browser, pairing).status_code == 200
    assert browser.post(DELETE, json={"confirm": A}).status_code == 204
    pairhelp.wait_for_next_poll(site)
    answer = poll(pairing)
    assert answer.status_code == 400 and "device_token" not in answer.text
    assert site.su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)


def test_the_deletion_needs_a_recent_sign_in(site: Site) -> None:
    a, _ = _two(site)
    site.su.execute("UPDATE player.sessions SET signed_in_at = now() - interval '11 minutes'")
    answer = a.browser.post(DELETE, json={"confirm": A})
    assert answer.status_code == 403 and answer.json() == {"error": "recent_sign_in_required"}
    assert all(_rows(site, a)[table] for table in KNOWN)


def test_the_deletion_needs_the_accounts_email_typed(site: Site) -> None:
    a, b = _two(site)
    before = _rows(site, a)
    for typed in (B, "", "a@example", A + "x"):
        answer = a.browser.post(DELETE, json={"confirm": typed})
        assert answer.status_code == 422 and answer.json() == {"error": "confirmation_mismatch"}
    for body in ({}, {"confirm": 5}, {"confirm": None}, {"confirm": "x" * 3000}):
        answer = a.browser.post(DELETE, json=body)
        assert answer.status_code == 422 and answer.json() == {"error": "invalid_request"}
    assert _rows(site, a) == before
    # Typed with other case and spaces around it, it is the same email.
    assert a.browser.post(DELETE, json={"confirm": "  A@Example.TEST "}).status_code == 204
    assert all(not rows for rows in _rows(site, a).values())
    assert b.browser.get("/api/site/sessions").status_code == 200


def test_the_deletion_is_refused_without_a_session_or_across_sites(site: Site) -> None:
    a, _ = _two(site)
    assert site.first.post(DELETE, json={"confirm": A}).json() == {"error": "not_signed_in"}
    cross = a.browser.post(DELETE, json={"confirm": A}, headers={"Origin": "https://evil.test"})
    assert cross.status_code == 403 and cross.json() == {"error": "cross_site_request"}
    assert all(_rows(site, a)[table] for table in KNOWN)


def test_the_email_can_sign_up_again_as_a_new_empty_account(site: Site) -> None:
    a, _ = _two(site)
    assert a.browser.post(DELETE, json={"confirm": A}).status_code == 204
    again = site.sign_in(A)  # still on the operator's allowlist
    assert again.get("/api/site/devices").json() == {"devices": []}
    row = site.su.execute("SELECT id FROM player.accounts WHERE email = %s", (A,)).fetchone()
    assert row is not None and row[0] != a.account_id
