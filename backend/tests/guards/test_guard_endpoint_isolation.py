"""Guard: with two accounts, every endpoint is called as one and can neither read nor change
the other's rows (ADR 0002, section 9, the last guard of its list).

Every route that enters an account must have a case below: a new one fails until it has.
"""

from __future__ import annotations

from collections.abc import Callable

from player_backend.site.deps import site_session
from tests.routehelp import routes_of
from tests.sitehelp import Browser, Site

A = "a@example.test"
B = "b@example.test"
SESSIONS = "/api/site/sessions"


def _snapshot(site: Site, email: str) -> list[tuple[object, ...]]:
    """Everything the account owns that these endpoints could touch."""
    sessions = site.su.execute(
        "SELECT 'session', s.id::text, s.token_hash::text FROM player.sessions s "
        "JOIN player.accounts a ON a.id = s.account_id WHERE a.email = %s ORDER BY 2",
        (email,),
    ).fetchall()
    events = site.su.execute(
        "SELECT 'event', e.id::text, e.event FROM player.audit_events e "
        "JOIN player.accounts a ON a.id = e.account_id WHERE a.email = %s ORDER BY 2",
        (email,),
    ).fetchall()
    return [*sessions, *events]


def _b_session_id(site: Site) -> str:
    row = site.su.execute(
        "SELECT s.id::text FROM player.sessions s JOIN player.accounts a ON a.id = s.account_id "
        "WHERE a.email = %s",
        (B,),
    ).fetchone()
    assert row is not None
    return str(row[0])


def _list(site: Site, a: Browser) -> None:
    listed = a.get(SESSIONS).json()["sessions"]
    assert len(listed) == 1 and listed[0]["current"] is True
    assert _b_session_id(site) not in str(listed)


def _end_one(site: Site, a: Browser) -> None:
    # B's session id is known to A here; it is still not A's to end.
    assert a.delete(f"{SESSIONS}/{_b_session_id(site)}").status_code == 404


def _sign_out(site: Site, a: Browser) -> None:
    assert a.post("/api/site/sign-out").status_code == 204


def _end_all(site: Site, a: Browser) -> None:
    assert a.post(f"{SESSIONS}/end-all").status_code == 204


CASES: dict[tuple[str, str], Callable[[Site, Browser], None]] = {
    ("GET", "/api/site/sessions"): _list,
    ("DELETE", "/api/site/sessions/{session_id}"): _end_one,
    ("POST", "/api/site/sign-out"): _sign_out,
    ("POST", "/api/site/sessions/end-all"): _end_all,
}


def test_every_endpoint_that_enters_an_account_has_a_case(site: Site) -> None:
    entering = {(r.method, r.path) for r in routes_of(site.app) if site_session in r.dependencies}
    assert entering == set(CASES)


def test_as_one_account_no_endpoint_reads_or_changes_the_others_rows(site: Site) -> None:
    site.allow(A)
    site.allow(B)
    b = site.sign_in(B, site.browser("198.51.100.2"))
    for case in CASES.values():
        site.su.execute("DELETE FROM player.rate_limits")
        a = site.sign_in(A, site.browser("198.51.100.1"))
        before = _snapshot(site, B)
        assert len(before) == 2
        case(site, a)
        assert _snapshot(site, B) == before
        assert b.get(SESSIONS).status_code == 200
    # And the cases did act on A's own rows: the last one ended every session of A.
    assert site.su.execute(
        "SELECT count(*) FROM player.sessions s JOIN player.accounts a ON a.id = s.account_id "
        "WHERE a.email = %s",
        (A,),
    ).fetchone() == (0,)
