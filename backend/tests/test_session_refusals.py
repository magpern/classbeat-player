"""What a refused or a late request leaves behind (ADR 0002, section 5): a refused signed-in
request still counts as use of its session, and signing out with no live session is answered
204 with the stale cookie cleared."""

from __future__ import annotations

import uuid

import pytest

from player_backend.client_policy import ClientInfo
from player_backend.db import site_sessions
from player_backend.db.context import AccountContext
from player_backend.token_issue import new_token
from tests.sitehelp import SESSION_COOKIE, Browser, Site

EMAIL = "rider@example.test"
SESSIONS = "/api/site/sessions"
SIGN_OUT = "/api/site/sign-out"
FRESH = "SELECT last_used_at > now() - interval '1 minute' FROM player.sessions"


def _signed_in_a_while_ago(site: Site) -> Browser:
    """Signed in 11 minutes ago and last seen 6 minutes ago: "last used" is due for a write."""
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    site.su.execute(
        "UPDATE player.sessions SET last_used_at = now() - interval '6 minutes', "
        "signed_in_at = now() - interval '11 minutes'"
    )
    return browser


def _cleared(set_cookie: list[str]) -> bool:
    found = [h for h in set_cookie if h.startswith(SESSION_COOKIE + "=")]
    return len(found) == 1 and all(
        part in found[0] for part in ("Max-Age=0", "Path=/", "Secure", "HttpOnly")
    )


def test_a_404_keeps_the_last_used_write(site: Site) -> None:
    browser = _signed_in_a_while_ago(site)
    refused = browser.delete(f"{SESSIONS}/{uuid.uuid4()}")
    assert refused.status_code == 404 and refused.json() == {"error": "not_found"}
    assert site.su.execute(FRESH).fetchone() == (True,)


def test_a_403_keeps_the_last_used_write(site: Site) -> None:
    browser = _signed_in_a_while_ago(site)
    refused = browser.post(f"{SESSIONS}/end-all")
    assert refused.status_code == 403 and refused.json() == {"error": "recent_sign_in_required"}
    assert site.su.execute(FRESH).fetchone() == (True,)
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)


def test_what_a_refusing_route_wrote_is_undone(site: Site, monkeypatch: pytest.MonkeyPatch) -> None:
    browser = _signed_in_a_while_ago(site)
    end_all = site_sessions.end_all_sessions

    def writes_and_refuses(ctx: AccountContext, session_id: uuid.UUID, client: ClientInfo) -> bool:
        assert end_all(ctx, client) == 1
        return False  # the route answers 404

    monkeypatch.setattr(site_sessions, "end_session", writes_and_refuses)
    events = len(site.events(EMAIL))
    assert browser.delete(f"{SESSIONS}/{uuid.uuid4()}").status_code == 404
    # The session it deleted and the event it wrote are gone; the session's use is kept.
    assert site.su.execute(FRESH).fetchone() == (True,)
    assert len(site.events(EMAIL)) == events


def test_an_error_that_is_no_refusal_rolls_back_everything(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser = _signed_in_a_while_ago(site)
    careless = site.browser(raise_errors=False)
    careless.take_cookies(browser)

    def breaks(ctx: AccountContext, session_id: uuid.UUID, client: ClientInfo) -> bool:
        raise RuntimeError("broken")

    monkeypatch.setattr(site_sessions, "end_session", breaks)
    assert careless.delete(f"{SESSIONS}/{uuid.uuid4()}").status_code == 500
    assert site.su.execute(FRESH).fetchone() == (False,)


def test_a_cross_site_request_is_refused_before_the_session_is_looked_at(site: Site) -> None:
    browser = _signed_in_a_while_ago(site)
    for path in (SIGN_OUT, f"{SESSIONS}/end-all"):
        refused = browser.post(path, headers={"Origin": "https://evil.test"})
        assert refused.status_code == 403 and refused.json() == {"error": "cross_site_request"}
        assert refused.headers.get_list("set-cookie") == []
    assert site.su.execute(FRESH).fetchone() == (False,)
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)


def test_sign_out_with_an_ended_session_answers_204_and_clears_the_cookie(site: Site) -> None:
    site.allow(EMAIL)
    here = site.sign_in(EMAIL)
    there = site.sign_in(EMAIL)
    ended = next(s["id"] for s in here.get(SESSIONS).json()["sessions"] if not s["current"])
    assert here.delete(f"{SESSIONS}/{ended}").status_code == 204
    events = site.events(EMAIL)

    assert there.cookies.get(SESSION_COOKIE) is not None
    out = there.post(SIGN_OUT)
    assert out.status_code == 204 and out.content == b""
    assert _cleared(out.headers.get_list("set-cookie"))
    assert there.cookies.get(SESSION_COOKIE) is None
    # Nobody was signed out: no event, and the other session lives on.
    assert site.events(EMAIL) == events
    assert here.get(SESSIONS).status_code == 200


@pytest.mark.parametrize("cookie", [None, "x", "an-unknown-token", "an-expired-session"])
def test_sign_out_with_no_live_session_answers_204(site: Site, cookie: str | None) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL) if cookie == "an-expired-session" else site.browser()
    if cookie == "an-expired-session":
        site.su.execute("UPDATE player.sessions SET last_used_at = now() - interval '15 days'")
    elif cookie is not None:
        value = new_token("ses") if cookie == "an-unknown-token" else cookie
        browser.cookies.set(SESSION_COOKIE, value, domain="player.test")
    out = browser.post(SIGN_OUT)
    assert out.status_code == 204 and _cleared(out.headers.get_list("set-cookie"))
    assert out.headers["cache-control"] == "no-store"


def test_only_sign_out_answers_a_dead_session_that_way(site: Site) -> None:
    browser = site.browser()
    browser.cookies.set(SESSION_COOKIE, new_token("ses"), domain="player.test")
    for method, path in (
        ("GET", SESSIONS),
        ("DELETE", f"{SESSIONS}/{uuid.uuid4()}"),
        ("POST", f"{SESSIONS}/end-all"),
    ):
        refused = browser.request(method, path)
        assert refused.status_code == 401 and refused.json() == {"error": "not_signed_in"}
        assert refused.headers.get_list("set-cookie") == []
