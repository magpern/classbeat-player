"""What holds for every request (ADR 0002, section 5): the headers on every route and every kind
of answer, and the cross-site checks on every state change."""

from __future__ import annotations

import uuid

import pytest
from httpx import Response

from player_backend.db import login
from tests.routehelp import routes_of
from tests.sitehelp import FIREFOX, ORIGIN, Site

EMAIL = "rider@example.test"
CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"


def _calls(site: Site) -> list[tuple[str, str]]:
    """(method, path) of every route of the app, with a value for each path parameter."""
    found: list[tuple[str, str]] = []
    for route in routes_of(site.app):
        path = route.path.replace("{session_id}", str(uuid.uuid4()))
        path = path.replace("{device_id}", str(uuid.uuid4()))
        path = path.replace("{link_id}", str(uuid.uuid4()))
        path = path.replace("{source_class_id}", "c1")
        path = path.replace("{class_id}", str(uuid.uuid4()))
        path = path.replace("{passkey_id}", str(uuid.uuid4()))
        assert "{" not in path, "a new path parameter needs a value here"
        found.append((route.method, path))
    return found


def _assert_headers(response: Response, path: str) -> None:
    assert response.headers["content-security-policy"] == CSP
    assert response.headers["referrer-policy"] == "no-referrer"
    if path.startswith(("/api/site/", "/api/pairing/", "/api/player/", "/api/source/")):
        assert response.headers["cache-control"] == "no-store"


def test_every_route_answers_with_the_headers_signed_in_or_not(site: Site) -> None:
    site.allow(EMAIL)
    calls = _calls(site)
    assert len(calls) >= 7
    statuses: set[int] = set()
    for signed_in in (False, True):
        for method, path in calls:
            for body in ({}, {"email": EMAIL}):
                # A browser of its own each time: one call may sign the browser out.
                site.su.execute("DELETE FROM player.rate_limits")
                browser = site.sign_in(EMAIL, site.browser())
                if not signed_in:
                    browser.cookies.clear()
                response = browser.request(method, path, json=body)
                statuses.add(response.status_code)
                _assert_headers(response, path)
    # Successes, refusals and bad input were all among them.
    assert {200, 204, 401, 404, 422} <= statuses


def test_every_response_that_carries_a_token_is_not_stored(site: Site) -> None:
    site.allow(EMAIL)
    asked = site.first.post("/api/site/sign-in/link", json={"email": EMAIL})
    assert "set-cookie" in asked.headers and asked.headers["cache-control"] == "no-store"
    token = site.ask(site.first, EMAIL)
    done = site.first.post("/api/site/sign-in/complete", json={"token": token})
    assert "set-cookie" in done.headers and done.headers["cache-control"] == "no-store"
    out = site.first.post("/api/site/sign-out")
    assert "set-cookie" in out.headers and out.headers["cache-control"] == "no-store"


def test_other_answers_have_the_headers_too(site: Site, monkeypatch: pytest.MonkeyPatch) -> None:
    missing = site.first.get("/api/site/nothing-here")
    assert missing.status_code == 404
    _assert_headers(missing, "/api/site/nothing-here")
    wrong_method = site.first.request("PUT", "/api/site/sign-out")
    assert wrong_method.status_code in (403, 405)
    _assert_headers(wrong_method, "/api/site/sign-out")
    cross_site = site.first.post("/api/site/sign-out", headers={"Origin": "https://evil.test"})
    assert cross_site.status_code == 403
    _assert_headers(cross_site, "/api/site/sign-out")
    health = site.first.get("/healthz")
    assert health.status_code == 200 and "cache-control" not in health.headers
    _assert_headers(health, "/healthz")

    def broken(*args: object, **kwargs: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(login, "request_link", broken)
    quiet = site.browser(raise_errors=False)
    failed = quiet.post("/api/site/sign-in/link", json={"email": EMAIL})
    assert failed.status_code == 500 and failed.json() == {"error": "internal_error"}
    _assert_headers(failed, "/api/site/sign-in/link")


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": None},
        {"Origin": "https://evil.test"},
        {"Origin": "null"},
        {"Origin": ORIGIN + ".evil.test"},
        {"Origin": ORIGIN.replace("https", "http")},
        {"Origin": ORIGIN + "/"},
        {"Origin": ORIGIN, "Sec-Fetch-Site": "cross-site"},
        {"Origin": ORIGIN, "Sec-Fetch-Site": "same-site"},
        {"Origin": ORIGIN, "Sec-Fetch-Site": "none"},
    ],
)
def test_a_cross_site_state_change_is_refused_on_every_route(
    site: Site, headers: dict[str, str | None]
) -> None:
    site.allow(EMAIL)
    # The site's API: the routes that take a cookie. The app's routes (pairing, the player
    # API) read none and are called without an `Origin`; the cookie-routes guard holds that.
    changing = [
        (m, p)
        for m, p in _calls(site)
        if m in {"POST", "PUT", "PATCH", "DELETE"} and p.startswith("/api/site/")
    ]
    assert len(changing) >= 8
    sent = {k: v for k, v in headers.items() if v is not None}
    for method, path in changing:
        signed_in = site.sign_in(EMAIL, site.browser(f"198.51.100.{len(changing)}"))
        # No default Origin here: exactly the headers of the case.
        browser = site.browser(headers={"User-Agent": FIREFOX})
        browser.take_cookies(signed_in)
        refused = browser.request(method, path, json={"email": EMAIL}, headers=sent)
        assert refused.status_code == 403 and refused.json() == {"error": "cross_site_request"}
        site.su.execute("DELETE FROM player.rate_limits")
    # Nothing was done: no mail beyond the sign-ins, and every session is still there.
    assert len(site.mailer.sent) == len(changing)
    assert site.su.execute("SELECT count(*) FROM player.sessions").fetchone() == (len(changing),)


def test_a_same_origin_state_change_and_a_read_go_through(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    fetch = {"Origin": ORIGIN, "Sec-Fetch-Site": "same-origin"}
    # A read needs no Origin: only state changes are checked.
    plain = site.browser(headers={})
    plain.take_cookies(browser)
    assert plain.get("/api/site/sessions").status_code == 200
    assert browser.post("/api/site/sign-out", headers=fetch).status_code == 204
