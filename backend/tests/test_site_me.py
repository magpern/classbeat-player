"""`GET /api/site/me` (ADR 0002, sections 4, 5 and 10; schema/site-api/v1/me.schema.json): the
signed-in account's own email and nothing else, for a live site session only, never stored.

Isolation between two accounts is also in tests/guards/test_guard_endpoint_isolation.py, the
cookie rule in tests/guards/test_guard_cookie_routes.py, the 16 KiB body cap in
tests/test_body_cap.py and the headers on every route in tests/test_site_requests.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pydantic
import pytest

from player_backend.db import account
from player_backend.db.context import AccountContext
from player_backend.site.answers import GENERATED_DIR, me_answer
from player_backend.token_issue import new_token
from tests.sitehelp import ORIGIN, SESSION_COOKIE, Browser, Site, link_token

EMAIL = "rider@example.test"
OTHER = "other@example.test"
ME = "/api/site/me"
SESSIONS = "/api/site/sessions"
NOT_SIGNED_IN = {"error": "not_signed_in"}
USED = "SELECT last_used_at FROM player.sessions"
FRESH = "SELECT last_used_at > now() - interval '1 minute' FROM player.sessions"


def _signed_in(site: Site, email: str = EMAIL, address: str = "198.51.100.1") -> Browser:
    site.allow(email)
    return site.sign_in(email, site.browser(address))


def _refused(browser: Browser) -> None:
    answer = browser.get(ME)
    assert answer.status_code == 401 and answer.json() == NOT_SIGNED_IN
    assert answer.headers["cache-control"] == "no-store"


def test_signed_in_the_answer_is_the_accounts_email_alone_and_not_stored(site: Site) -> None:
    browser = _signed_in(site)
    answer = browser.get(ME)
    assert answer.status_code == 200
    assert answer.json() == {"email": EMAIL}
    assert answer.headers["content-type"] == "application/json"
    assert answer.headers["cache-control"] == "no-store"
    # Read only: no cookie is set, nothing is written but the session's "last used".
    assert "set-cookie" not in answer.headers


def test_the_email_is_answered_as_stored(site: Site) -> None:
    # Typed with spaces and capitals; stored trimmed and lower-cased, and answered so.
    site.allow(EMAIL)
    browser = site.browser()
    asked = browser.post("/api/site/sign-in/link", json={"email": "  Rider@Example.TEST "})
    assert asked.status_code == 200
    (mail,) = site.mailer.sent
    assert mail.to == EMAIL
    token = link_token(mail)
    assert browser.post("/api/site/sign-in/complete", json={"token": token}).status_code == 200
    assert browser.get(ME).json() == {"email": EMAIL}


def test_an_email_with_an_at_sign_in_its_local_part_is_answered(site: Site) -> None:
    strange = "a@b@example.test"
    browser = _signed_in(site, strange)
    assert browser.get(ME).json() == {"email": strange}


@pytest.mark.parametrize(
    "cookie", [None, "", "x", "cbp_ses_short", new_token("dev"), new_token("ses")]
)
def test_signed_out_or_with_a_cookie_that_is_no_session_is_401(
    site: Site, cookie: str | None
) -> None:
    _signed_in(site)
    browser = site.browser()
    if cookie is not None:
        browser.cookies.set(SESSION_COOKIE, cookie, domain="player.test")
    _refused(browser)


def test_the_session_token_as_a_bearer_token_is_401(site: Site) -> None:
    session = _signed_in(site).cookies.get(SESSION_COOKIE)
    assert session is not None
    answer = site.browser().get(ME, headers={"Authorization": "Bearer " + session})
    assert answer.status_code == 401 and answer.json() == NOT_SIGNED_IN


def test_each_session_sees_its_own_account_and_never_the_others(site: Site) -> None:
    a = _signed_in(site, EMAIL, "198.51.100.1")
    b = _signed_in(site, OTHER, "198.51.100.2")
    a_answer = a.get(ME)
    b_answer = b.get(ME)
    assert a_answer.json() == {"email": EMAIL} and OTHER not in a_answer.text
    assert b_answer.json() == {"email": OTHER} and EMAIL not in b_answer.text
    # A's session ended: its cookie shows nothing, not B's account or any other.
    assert a.post("/api/site/sign-out").status_code == 204
    _refused(a)
    assert b.get(ME).json() == {"email": OTHER}


@pytest.mark.parametrize(
    ("column", "age", "status"),
    [
        ("last_used_at", "14 days 1 minute", 401),
        ("last_used_at", "13 days 23 hours", 200),
        ("created_at", "60 days 1 minute", 401),
        ("created_at", "59 days 23 hours", 200),
    ],
)
def test_an_expired_session_is_401(site: Site, column: str, age: str, status: int) -> None:
    browser = _signed_in(site)
    if column == "last_used_at":
        site.su.execute("UPDATE player.sessions SET last_used_at = now() - %s::interval", (age,))
    else:
        site.su.execute("UPDATE player.sessions SET created_at = now() - %s::interval", (age,))
    answer = browser.get(ME)
    assert answer.status_code == status
    assert answer.json() == (NOT_SIGNED_IN if status == 401 else {"email": EMAIL})


def test_a_session_ended_from_another_browser_is_401(site: Site) -> None:
    browser = _signed_in(site)
    other = site.sign_in(EMAIL, site.browser("198.51.100.9"))
    listed = other.get(SESSIONS).json()["sessions"]
    (first,) = [s["id"] for s in listed if not s["current"]]
    assert other.delete(f"{SESSIONS}/{first}").status_code == 204
    _refused(browser)
    assert other.get(ME).json() == {"email": EMAIL}


def test_every_session_ended_or_the_account_deleted_is_401(site: Site) -> None:
    browser = _signed_in(site)
    other = site.sign_in(EMAIL, site.browser("198.51.100.9"))
    assert other.post(f"{SESSIONS}/end-all").status_code == 204
    _refused(browser)
    _refused(other)
    again = site.sign_in(EMAIL, site.browser("198.51.100.9"))
    kept = site.browser("198.51.100.9")
    kept.take_cookies(again)  # still holds the session's cookie once `again` has it cleared
    deleted = again.post("/api/site/account/delete", json={"confirm": EMAIL})
    assert deleted.status_code == 204
    _refused(kept)


def test_last_used_is_written_at_most_every_5_minutes(site: Site) -> None:
    browser = _signed_in(site)
    site.su.execute("UPDATE player.sessions SET last_used_at = now() - interval '4 minutes'")
    kept = site.su.execute(USED).fetchone()
    assert browser.get(ME).status_code == 200
    assert site.su.execute(USED).fetchone() == kept
    site.su.execute("UPDATE player.sessions SET last_used_at = now() - interval '6 minutes'")
    assert browser.get(ME).status_code == 200
    assert site.su.execute(FRESH).fetchone() == (True,)


def test_a_request_the_route_refuses_keeps_last_used(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    # As on every signed-in route, a refusal by the route still counts as the session's use.
    browser = _signed_in(site)
    site.su.execute("UPDATE player.sessions SET last_used_at = now() - interval '6 minutes'")

    def gone(ctx: AccountContext) -> str | None:
        return None

    monkeypatch.setattr(account, "email", gone)
    _refused(browser)
    assert site.su.execute(FRESH).fetchone() == (True,)
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)


def test_a_query_string_or_a_body_changes_nothing(site: Site) -> None:
    # The route takes no parameter, so the framework has nothing to refuse inside the session.
    browser = _signed_in(site)
    for path in (f"{ME}?email={OTHER}", f"{ME}?x=1&x=2", f"{ME}?%00"):
        assert browser.get(path).json() == {"email": EMAIL}
    sent = browser.request("GET", ME, json={"email": OTHER})
    assert sent.status_code == 200 and sent.json() == {"email": EMAIL}


def test_only_get_is_served(site: Site) -> None:
    browser = _signed_in(site)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        answer = browser.request(method, ME, headers={"Origin": ORIGIN})
        assert answer.status_code == 405, method


def test_an_email_the_contract_refuses_is_never_answered(site: Site) -> None:
    # Checked through the generated model: a stored value outside the contract is an error,
    # and the answer carries nothing of it.
    browser = _signed_in(site)
    site.su.execute("UPDATE player.accounts SET email = %s", ("rider x@example.test",))
    careless = site.browser(raise_errors=False)
    careless.take_cookies(browser)
    answer = careless.get(ME)
    assert answer.status_code == 500 and answer.json() == {"error": "internal_error"}
    assert "rider" not in answer.text
    assert answer.headers["cache-control"] == "no-store"


def test_the_model_is_the_contracts_generated_one() -> None:
    model = me_answer()
    assert Path(GENERATED_DIR, "site_api_me.py").is_file()
    assert model.__name__ == "MeAnswer" and model.__module__ == "site_api_me"
    assert sys.modules["site_api_me"].__file__ == str(GENERATED_DIR / "site_api_me.py")
    assert model(email=EMAIL).model_dump(mode="json") == {"email": EMAIL}
    with pytest.raises(pydantic.ValidationError):
        model.model_validate({"email": EMAIL, "id": "x"})
    for refused in ("Rider@example.test", "a b@example.test", "ab", "a@b@C.test"):
        with pytest.raises(pydantic.ValidationError):
            model(email=refused)
    # Loaded once per process.
    assert me_answer() is model
