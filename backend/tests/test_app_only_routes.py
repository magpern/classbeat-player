"""The app's routes that take no credential, `/api/pairing/start` and `/api/pairing/token`, are
for the desktop app alone (ADR 0002, sections 6 and 10; issue #71, the Orchestrator's decision).

A browser sends `Sec-Fetch-Site` with every request; the app's main process does not. A request
that has the header with any value but `none` is refused (403), and so is a body that is not
sent as `application/json` (415). Both before anything is counted, looked up or written.
"""

from __future__ import annotations

import json

import pytest

from player_backend.request_policy import app_request_refusal
from tests import pairhelp
from tests.pairhelp import START, TOKEN
from tests.sitehelp import FIREFOX, ORIGIN, Site

EMAIL = "rider@example.test"
JSON = "application/json"
ROUTES = (START, TOKEN)
START_BODY = {"platform": "linux", "version": "1.0"}

FROM_A_PAGE = ["cross-site", "same-site", "same-origin", "", "None", "NONE", " none", "none,none"]
NOT_JSON = [
    None,
    "",
    "text/plain",
    "text/plain; charset=utf-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/jsonx",
    "application/json-seq",
    "application/vnd.api+json",
    "text/json",
    "json",
    "application/json, text/plain",
]
AS_JSON = [JSON, "application/json; charset=utf-8", "Application/JSON", " application/json ;x=y"]


@pytest.mark.parametrize("sec_fetch_site", FROM_A_PAGE)
def test_the_rule_refuses_a_request_from_a_page(sec_fetch_site: str) -> None:
    assert app_request_refusal(sec_fetch_site, JSON) == "browser"
    # The page is refused first, whatever its body is sent as.
    assert app_request_refusal(sec_fetch_site, None) == "browser"


@pytest.mark.parametrize("content_type", NOT_JSON)
def test_the_rule_refuses_a_body_that_is_not_sent_as_json(content_type: str | None) -> None:
    assert app_request_refusal(None, content_type) == "content_type"
    assert app_request_refusal("none", content_type) == "content_type"


@pytest.mark.parametrize("content_type", AS_JSON)
def test_the_rule_lets_the_apps_own_request_through(content_type: str) -> None:
    assert app_request_refusal(None, content_type) is None
    assert app_request_refusal("none", content_type) is None


def _nothing_written(site: Site) -> None:
    counts = site.su.execute(
        "SELECT (SELECT count(*) FROM player.pairings), (SELECT count(*) FROM player.devices), "
        "(SELECT count(*) FROM player.rate_limits)"
    ).fetchone()
    assert counts == (0, 0, 0)


@pytest.mark.parametrize("sec_fetch_site", FROM_A_PAGE)
def test_a_request_from_a_page_is_refused_on_both_routes(site: Site, sec_fetch_site: str) -> None:
    app = pairhelp.app_client(site)
    for path in ROUTES:
        refused = app.post(path, json=START_BODY, headers={"Sec-Fetch-Site": sec_fetch_site})
        assert refused.status_code == 403 and refused.json() == {"error": "cross_site_request"}
        assert refused.headers["cache-control"] == "no-store"
    _nothing_written(site)


def test_a_page_of_the_site_itself_is_refused_too(site: Site) -> None:
    # Same-origin, with the site's `Origin` and a browser's headers: still not the app.
    page = site.browser(headers={"Origin": ORIGIN, "User-Agent": FIREFOX})
    for path in ROUTES:
        refused = page.post(path, json=START_BODY, headers={"Sec-Fetch-Site": "same-origin"})
        assert refused.status_code == 403
    _nothing_written(site)


@pytest.mark.parametrize("content_type", NOT_JSON)
def test_a_body_that_is_not_sent_as_json_is_refused_on_both_routes(
    site: Site, content_type: str | None
) -> None:
    app = pairhelp.app_client(site)
    headers = {} if content_type is None else {"Content-Type": content_type}
    # A body that would be accepted as JSON if it were sent as JSON, and no body at all.
    for content in (json.dumps(START_BODY).encode(), b""):
        for path in ROUTES:
            refused = app.post(path, content=content, headers=headers)
            assert refused.status_code == 415, (path, content)
            assert refused.json() == {"error": "unsupported_media_type"}
            assert refused.headers["cache-control"] == "no-store"
    # A body that is not JSON at all is refused as well: by this check, or before it by the
    # framework's own parser where the type is one it reads as JSON (`+json`).
    for path in ROUTES:
        refused = app.post(path, content=b"platform=linux&version=1.0", headers=headers)
        assert refused.status_code in (415, 422), path
        assert refused.json()["error"] in ("unsupported_media_type", "invalid_request")
    _nothing_written(site)


@pytest.mark.parametrize("content_type", AS_JSON)
def test_the_apps_own_request_goes_through(site: Site, content_type: str) -> None:
    app = pairhelp.app_client(site)
    content = json.dumps(START_BODY).encode()
    for fetch in ({}, {"Sec-Fetch-Site": "none"}):
        started = app.post(START, content=content, headers={"Content-Type": content_type, **fetch})
        assert started.status_code == 200, started.text
        poll = json.dumps({"device_code": started.json()["device_code"]}).encode()
        polled = app.post(TOKEN, content=poll, headers={"Content-Type": content_type, **fetch})
        assert polled.status_code == 400 and polled.json() == {"error": "authorization_pending"}


def test_a_refused_poll_collects_nothing_and_is_not_a_poll(site: Site) -> None:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    pairing = pairhelp.start(site)
    assert pairhelp.approve(browser, pairing).status_code == 200
    body = {"device_code": pairing.device_code}
    from_a_page = pairing.app.post(TOKEN, json=body, headers={"Sec-Fetch-Site": "cross-site"})
    assert from_a_page.status_code == 403 and "device_token" not in from_a_page.text
    as_text = pairing.app.post(
        TOKEN, content=json.dumps(body).encode(), headers={"Content-Type": "text/plain"}
    )
    assert as_text.status_code == 415 and "device_token" not in as_text.text
    # The pairing waits as it was: approved, never polled, no device made.
    waiting = site.su.execute("SELECT state, last_polled_at FROM player.pairings").fetchall()
    assert waiting == [("approved", None)]
    assert site.su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)
    assert pairhelp.poll(pairing).status_code == 200


def test_refused_starts_do_not_use_up_the_addresses_ten_an_hour(site: Site) -> None:
    app = pairhelp.app_client(site)
    pairhelp.settle(site, 3600)
    for _ in range(12):
        assert app.post(START, json=START_BODY, headers={"Sec-Fetch-Site": "cross-site"}).is_error
        assert app.post(START, content=json.dumps(START_BODY).encode()).status_code == 415
    for _ in range(10):
        pairhelp.start(site, app)
    assert app.post(START, json=START_BODY).status_code == 429
