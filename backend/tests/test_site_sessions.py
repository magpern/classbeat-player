"""Site sessions through the API (ADR 0002, section 5): the cookie, idle and total expiry,
listing, ending one, signing out, ending all, the recent sign-in check and the cap of 20."""

from __future__ import annotations

from contextlib import AbstractContextManager

import pytest

from player_backend.db import site_sessions
from player_backend.db.context import AccountContext
from player_backend.db.executor import Pool
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash
from tests.sitehelp import ORIGIN, SESSION_COOKIE, Browser, Site

EMAIL = "rider@example.test"
SESSIONS = "/api/site/sessions"


def _signed_in(site: Site) -> Browser:
    site.allow(EMAIL)
    return site.sign_in(EMAIL)


def _cleared(set_cookie: list[str]) -> bool:
    """Whether the response deletes the session cookie, with the attributes `__Host-` needs."""
    found = [h for h in set_cookie if h.startswith(SESSION_COOKIE + "=")]
    return len(found) == 1 and all(
        part in found[0] for part in ("Max-Age=0", "Path=/", "Secure", "HttpOnly")
    )


def test_no_cookie_or_a_cookie_that_is_no_session_token_is_not_signed_in(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser = _signed_in(site)
    session = browser.cookies.get(SESSION_COOKIE)
    assert session is not None
    used = site.su.execute("SELECT last_used_at FROM player.sessions").fetchone()
    lookups: list[bytes] = []
    entered = site_sessions.entered

    def counted(pool: Pool, token_hash: bytes) -> AbstractContextManager[AccountContext | None]:
        lookups.append(token_hash)
        return entered(pool, token_hash)

    monkeypatch.setattr(site_sessions, "entered", counted)
    wrong_shape = (None, "", "x", session + "A", session.replace("_ses_", "_dev_"))
    for value in (*wrong_shape, new_token("ses")):
        other = site.browser()
        if value is not None:
            other.cookies.set(SESSION_COOKIE, value, domain="player.test")
        refused = other.get(SESSIONS)
        assert refused.status_code == 401 and refused.json() == {"error": "not_signed_in"}
    # The session token is accepted as a cookie only: never as a bearer token.
    bearer = site.browser().get(SESSIONS, headers={"Authorization": "Bearer " + session})
    assert bearer.status_code == 401
    # Refused by its shape, before any lookup: only the well-formed unknown token was looked up.
    assert len(lookups) == 1
    assert site.su.execute("SELECT last_used_at FROM player.sessions").fetchone() == used


@pytest.mark.parametrize(
    ("column", "age", "status"),
    [
        ("last_used_at", "14 days 1 minute", 401),
        ("last_used_at", "13 days 23 hours", 200),
        ("created_at", "60 days 1 minute", 401),
        ("created_at", "59 days 23 hours", 200),
    ],
)
def test_a_session_ends_after_14_days_idle_or_60_days_in_all(
    site: Site, column: str, age: str, status: int
) -> None:
    browser = _signed_in(site)
    if column == "last_used_at":
        site.su.execute("UPDATE player.sessions SET last_used_at = now() - %s::interval", (age,))
    else:
        site.su.execute("UPDATE player.sessions SET created_at = now() - %s::interval", (age,))
    assert browser.get(SESSIONS).status_code == status


def test_last_used_is_written_at_most_once_every_5_minutes(site: Site) -> None:
    browser = _signed_in(site)
    site.su.execute("UPDATE player.sessions SET last_used_at = now() - interval '4 minutes'")
    assert browser.get(SESSIONS).status_code == 200
    fresh = "SELECT last_used_at > now() - interval '1 minute' FROM player.sessions"
    assert site.su.execute(fresh).fetchone() == (False,)
    site.su.execute("UPDATE player.sessions SET last_used_at = now() - interval '6 minutes'")
    assert browser.get(SESSIONS).status_code == 200
    assert site.su.execute(fresh).fetchone() == (True,)


def test_sessions_are_listed_and_one_can_be_ended(site: Site) -> None:
    here = _signed_in(site)
    there = site.sign_in(EMAIL, site.browser())
    listed = here.get(SESSIONS).json()["sessions"]
    assert sorted(s["current"] for s in listed) == [False, True]
    assert set(listed[0]) == {"id", "browser", "created_at", "last_used_at", "current"}
    other = next(s["id"] for s in listed if not s["current"])

    ended = here.delete(f"{SESSIONS}/{other}")
    assert ended.status_code == 204 and ended.headers.get_list("set-cookie") == []
    # Revocation deletes the row: it takes effect on the next request.
    assert there.get(SESSIONS).status_code == 401
    assert here.get(SESSIONS).status_code == 200
    assert here.delete(f"{SESSIONS}/{other}").status_code == 404
    assert site.events(EMAIL)[-1] == ("session.signed_out", {"current": False})


def test_ending_the_current_session_or_signing_out_clears_the_cookie(site: Site) -> None:
    here = _signed_in(site)
    there = site.sign_in(EMAIL, site.browser())
    own = next(s["id"] for s in here.get(SESSIONS).json()["sessions"] if s["current"])
    ended = here.delete(f"{SESSIONS}/{own}")
    assert ended.status_code == 204 and _cleared(ended.headers.get_list("set-cookie"))
    assert here.cookies.get(SESSION_COOKIE) is None

    out = there.post("/api/site/sign-out")
    assert out.status_code == 204 and _cleared(out.headers.get_list("set-cookie"))
    assert there.get(SESSIONS).status_code == 401
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (0,)
    assert site.events(EMAIL)[-2:] == [("session.signed_out", {"current": True})] * 2
    kinds = site.su.execute(
        "SELECT DISTINCT credential_kind, client_network::text, client_family "
        "FROM player.audit_events WHERE event = 'session.signed_out'"
    ).fetchall()
    assert kinds == [("session", "203.0.113.0/24", "Firefox")]


def test_a_stolen_cookie_stops_working_at_sign_out(site: Site) -> None:
    here = _signed_in(site)
    stolen = here.cookies.get(SESSION_COOKIE)
    assert stolen is not None
    thief = site.browser("192.0.2.9")
    thief.cookies.set(SESSION_COOKIE, stolen, domain="player.test")
    assert thief.get(SESSIONS).status_code == 200
    assert here.post("/api/site/sign-out").status_code == 204
    assert thief.get(SESSIONS).status_code == 401


def test_ending_all_sessions_needs_a_recent_sign_in(site: Site) -> None:
    here = _signed_in(site)
    there = site.sign_in(EMAIL, site.browser())
    site.su.execute("UPDATE player.sessions SET signed_in_at = now() - interval '11 minutes'")
    refused = here.post(f"{SESSIONS}/end-all")
    assert refused.status_code == 403 and refused.json() == {"error": "recent_sign_in_required"}
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (2,)

    site.su.execute("UPDATE player.sessions SET signed_in_at = now() - interval '9 minutes'")
    done = here.post(f"{SESSIONS}/end-all")
    assert done.status_code == 204 and _cleared(done.headers.get_list("set-cookie"))
    assert there.get(SESSIONS).status_code == 401
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (0,)
    assert site.events(EMAIL)[-1] == ("session.all_ended", {"sessions": 2})


def test_at_most_20_sessions_per_account_the_oldest_is_dropped(site: Site) -> None:
    first = _signed_in(site)
    account = site.su.execute("SELECT id FROM player.accounts").fetchone()
    assert account is not None
    site.su.execute("UPDATE player.sessions SET created_at = now() - interval '30 days'")
    for day in range(1, 20):
        site.su.execute(
            "INSERT INTO player.sessions (account_id, token_hash, created_at) "
            "VALUES (%s, %s, now() - %s * interval '1 day')",
            (account[0], token_hash(new_token("ses")), day),
        )
    assert first.get(SESSIONS).status_code == 200
    newest = site.sign_in(EMAIL, site.browser())
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (20,)
    assert first.get(SESSIONS).status_code == 401
    assert newest.get(SESSIONS).status_code == 200


def test_a_refused_request_changes_nothing(site: Site) -> None:
    here = _signed_in(site)
    own = here.get(SESSIONS).json()["sessions"][0]["id"]
    refused = here.delete(f"{SESSIONS}/{own}", headers={"Origin": "https://evil.test"})
    assert refused.status_code == 403
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)
    assert ORIGIN != "https://evil.test" and here.get(SESSIONS).status_code == 200


def test_the_requests_transaction_is_committed_before_the_response_is_sent(site: Site) -> None:
    browser = _signed_in(site)
    token = browser.cookies.get(SESSION_COOKIE)
    assert token is not None
    sessions_when_the_response_started: list[object] = []

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, object]) -> None:
        if message["type"] == "http.response.start":
            assert message["status"] == 204
            sessions_when_the_response_started.append(
                site.su.execute("SELECT count(*) FROM player.sessions").fetchone()
            )

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": "/api/site/sign-out",
        "raw_path": b"/api/site/sign-out",
        "query_string": b"",
        "headers": [
            (b"host", b"player.test"),
            (b"origin", ORIGIN.encode()),
            (b"cookie", (SESSION_COOKIE + "=" + token).encode()),
        ],
        "client": ("203.0.113.7", 40000),
        "server": ("player.test", 443),
    }
    site.loop.run_until_complete(site.app(scope, receive, send))  # pyright: ignore[reportArgumentType]
    # A sign-out that could not be committed would otherwise be answered 204 all the same.
    assert sessions_when_the_response_started == [(0,)]
