"""Guard: the routes that read a cookie equal the written list (ADR 0002, section 5).

The session cookie is accepted by the site's API (`/api/site/`) and by exactly one live route,
`POST /api/live/controller` (PL8). Nowhere else. A new route that reads a cookie
fails here until it is listed, and it can be listed only if the ADR allows it.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from player_backend.app import create_app
from player_backend.player_api.deps import app_only, device_token
from player_backend.settings import Settings
from player_backend.site.cookies import login_cookie_token, session_cookie_token
from player_backend.site.deps import same_origin, site_session
from player_backend.source_api.deps import source_token
from tests.guards.cookie_source_check import READERS, check_source, check_tree
from tests.routehelp import RouteInfo, routes_of

SRC = Path(__file__).resolve().parents[2] / "src"
OUTSIDE = "player_backend/player_api.py"

# The written lists. A change here is a change to where a cookie is accepted: security-critical.
SESSION_COOKIE_ROUTES = frozenset(
    {
        ("GET", "/api/site/sessions"),
        ("DELETE", "/api/site/sessions/{session_id}"),
        ("POST", "/api/site/sign-out"),
        ("POST", "/api/site/sessions/end-all"),
        # Section 4: the signed-in account's own email (#265).
        ("GET", "/api/site/me"),
        # Section 6, step 3 and "The site lists devices": the signed-in user's side of pairing.
        ("POST", "/api/site/pairing/find"),
        ("POST", "/api/site/pairing/decide"),
        ("GET", "/api/site/devices"),
        ("DELETE", "/api/site/devices/{device_id}"),
        # Section 7, steps 2 to 4 and "The site lists them": the signed-in user's side of a link.
        ("POST", "/api/site/source-links/check"),
        ("POST", "/api/site/source-links/approve"),
        ("GET", "/api/site/source-links"),
        ("DELETE", "/api/site/source-links/{link_id}"),
        # Section 12: the account's export and its deletion, both behind a recent sign-in.
        ("POST", "/api/site/account/export"),
        ("POST", "/api/site/account/delete"),
        # Plan, section 5, "Class library", and section 12: the account's classes on the site.
        ("GET", "/api/site/classes"),
        ("GET", "/api/site/classes/{class_id}"),
        ("DELETE", "/api/site/classes/{class_id}"),
        # ADR 0002, section 4: the account's passkeys (adding and removing behind a recent
        # sign-in).
        ("GET", "/api/site/passkeys"),
        ("POST", "/api/site/passkeys/options"),
        ("POST", "/api/site/passkeys"),
        ("PATCH", "/api/site/passkeys/{passkey_id}"),
        ("DELETE", "/api/site/passkeys/{passkey_id}"),
        # Section 8, "Becoming a controller": the one live route that takes the session cookie.
        ("POST", "/api/live/controller"),
    }
)
# The app's routes: pairing takes the device code in the body, the player API a device token
# in `Authorization: Bearer`. None of them reads a cookie.
DEVICE_TOKEN_ROUTES = frozenset(
    {
        ("GET", "/api/player/device"),
        ("DELETE", "/api/player/device"),
        # Section 6, "Scope": the account's classes, removals and cursor, read only.
        ("GET", "/api/player/changes"),
        ("GET", "/api/player/classes/{class_id}"),
        ("GET", "/api/player/cursor"),
        # Section 8: the app starts a live session with its device token (ADR 0005, s. 4).
        ("POST", "/api/live/sessions"),
    }
)
# The source API (section 7): a source token in `Authorization: Bearer`, never a cookie.
SOURCE_TOKEN_ROUTES = frozenset(
    {
        ("POST", "/api/source/publications"),
        ("GET", "/api/source/classes/{source_class_id}"),
        ("DELETE", "/api/source/link"),
    }
)
# The code exchange (section 7, step 5): the source link code in the body, from the source's
# server. No cookie and no other credential.
LINK_CODE_ROUTES = frozenset({("POST", "/api/source/token")})
# Section 8, "Becoming a controller": the join code and the control code in the body, from the
# phone's page. No cookie and no other credential.
CONTROL_CODE_ROUTES = frozenset({("POST", "/api/live/control")})
# Section 8, "Joining as a rider" (ADR 0007): the join code and a nickname in the body, from the
# rider's page. No cookie and no other credential.
JOIN_ROUTES = frozenset({("POST", "/api/live/join")})
NO_CREDENTIAL_ROUTES = frozenset(
    {
        ("GET", "/healthz"),
        ("POST", "/api/pairing/start"),
        ("POST", "/api/pairing/token"),
    }
)
# The companion page's built files (control_page.py, #266): no credential, no dependency, no
# body; the path parameter is a file name looked up in a fixed table, never a credential.
PAGE_ROUTES = frozenset(
    {
        ("GET", "/control"),
        ("GET", "/control/{name:path}"),
    }
)
# The browser token's cookie signs nobody in; it is read where a sign-in starts and ends.
LOGIN_COOKIE_ROUTES = frozenset(
    {
        ("POST", "/api/site/sign-in/link"),
        ("POST", "/api/site/sign-in/complete"),
        # ADR 0002, section 4: a passkey sign-in's challenge is bound to the browser token.
        ("POST", "/api/site/sign-in/passkey/options"),
        ("POST", "/api/site/sign-in/passkey"),
    }
)
SITE_API = "/api/site/"
LIVE_COOKIE_ROUTE = ("POST", "/api/live/controller")
# The one device-token route outside the player API (section 8).
LIVE_SESSIONS_ROUTE = ("POST", "/api/live/sessions")


def _routes() -> list[RouteInfo]:
    # A placeholder URL: making the app opens no connection.
    settings = Settings(
        database_url="postgresql://player_app:placeholder@127.0.0.1:1/none",
        site_origin="https://player.test",
    )
    return routes_of(create_app(settings))


def _using(dependency: object) -> set[tuple[str, str]]:
    return {(r.method, r.path) for r in _routes() if dependency in r.dependencies}


def test_the_routes_that_read_the_session_cookie_equal_the_list() -> None:
    assert _using(session_cookie_token) == SESSION_COOKIE_ROUTES


def test_the_routes_that_read_the_browser_tokens_cookie_equal_the_list() -> None:
    assert _using(login_cookie_token) == LOGIN_COOKIE_ROUTES


def test_the_readers_checked_here_are_all_the_readers() -> None:
    assert {session_cookie_token.__name__, login_cookie_token.__name__} == READERS


def test_the_session_cookie_is_read_by_the_session_dependency_alone() -> None:
    # One dependency per credential type: no route reads the cookie beside it.
    assert _using(session_cookie_token) == _using(site_session)


def test_the_routes_that_take_a_device_token_equal_the_list_and_read_no_cookie() -> None:
    assert _using(device_token) == DEVICE_TOKEN_ROUTES
    assert not _using(device_token) & (_using(session_cookie_token) | _using(login_cookie_token))
    for method, path in DEVICE_TOKEN_ROUTES:
        assert path.startswith("/api/player/") or (method, path) == LIVE_SESSIONS_ROUTE


def test_the_routes_that_take_a_source_token_equal_the_list_and_read_no_cookie() -> None:
    assert _using(source_token) == SOURCE_TOKEN_ROUTES
    assert not _using(source_token) & (_using(session_cookie_token) | _using(login_cookie_token))
    assert not _using(source_token) & _using(device_token)
    for _, path in SOURCE_TOKEN_ROUTES | LINK_CODE_ROUTES:
        assert path.startswith("/api/source/")


def test_the_code_exchange_takes_no_cookie_and_no_bearer_token() -> None:
    bearer = _using(device_token) | _using(source_token)
    cookie = _using(session_cookie_token) | _using(login_cookie_token)
    assert not LINK_CODE_ROUTES & (bearer | cookie)


def test_the_control_code_route_takes_no_cookie_and_no_bearer_token() -> None:
    bearer = _using(device_token) | _using(source_token) | _using(app_only)
    cookie = _using(session_cookie_token) | _using(login_cookie_token)
    assert not CONTROL_CODE_ROUTES & (bearer | cookie)
    assert all(path.startswith("/api/live/") for _, path in CONTROL_CODE_ROUTES)


def test_the_join_route_takes_no_cookie_and_no_bearer_token() -> None:
    bearer = _using(device_token) | _using(source_token) | _using(app_only)
    cookie = _using(session_cookie_token) | _using(login_cookie_token)
    assert not JOIN_ROUTES & (bearer | cookie)
    assert all(path.startswith("/api/live/") for _, path in JOIN_ROUTES)


def test_every_route_is_on_one_of_the_lists() -> None:
    # A new route fails here until someone has said which credential it takes.
    listed = (
        SESSION_COOKIE_ROUTES
        | LOGIN_COOKIE_ROUTES
        | DEVICE_TOKEN_ROUTES
        | SOURCE_TOKEN_ROUTES
        | LINK_CODE_ROUTES
        | CONTROL_CODE_ROUTES
        | JOIN_ROUTES
    )
    assert {(r.method, r.path) for r in _routes()} == listed | NO_CREDENTIAL_ROUTES | PAGE_ROUTES
    assert not listed & NO_CREDENTIAL_ROUTES
    assert not (listed | NO_CREDENTIAL_ROUTES) & PAGE_ROUTES


def test_the_page_routes_take_no_dependency_and_only_read() -> None:
    pages = [r for r in _routes() if (r.method, r.path) in PAGE_ROUTES]
    assert {(r.method, r.path) for r in pages} == PAGE_ROUTES
    assert all(not r.dependencies for r in pages)
    assert all(r.method == "GET" and r.path.startswith("/control") for r in pages)


def test_every_route_without_a_credential_but_the_health_check_is_for_the_app_alone() -> None:
    # The pairing routes take no credential, so nothing but this check stands between a page
    # in a browser and them: each applies it, and a new one fails here until it does.
    open_routes = {(m, p) for m, p in NO_CREDENTIAL_ROUTES if p != "/healthz"}
    assert open_routes and all(p.startswith("/api/pairing/") for _, p in open_routes)
    assert _using(app_only) == open_routes


def test_every_cookie_route_is_in_the_sites_api_or_is_the_one_live_route() -> None:
    for method, path in SESSION_COOKIE_ROUTES | LOGIN_COOKIE_ROUTES:
        assert path.startswith(SITE_API) or (method, path) == LIVE_COOKIE_ROUTE


def test_every_cookie_route_applies_the_origin_check() -> None:
    cookie_routes = _using(session_cookie_token) | _using(login_cookie_token)
    assert cookie_routes <= _using(same_origin)


def test_no_route_takes_a_token_in_its_path() -> None:
    # Principle 3. The path parameters are a session's, a device's and a link's id, a
    # source's own class id, a class row's id and a passkey row's id, and a file name of the
    # companion page: not credentials.
    parameters = {r.path for r in _routes() if "{" in r.path}
    assert parameters == {
        "/api/site/sessions/{session_id}",
        "/api/site/devices/{device_id}",
        "/api/site/source-links/{link_id}",
        "/api/source/classes/{source_class_id}",
        "/api/player/classes/{class_id}",
        "/api/site/classes/{class_id}",
        "/api/site/passkeys/{passkey_id}",
        "/control/{name:path}",
    }


def test_backend_source_reads_cookies_only_in_the_cookie_module() -> None:
    assert check_tree(SRC) == []


@pytest.mark.parametrize(
    "snippet",
    [
        'token = request.cookies.get("x")',
        "jar = request.cookies",
        "from fastapi import Cookie",
        "import fastapi\ndef f(session: str = fastapi.Cookie()): ...",
        "from http.cookies import SimpleCookie",
        "import http.cookies",
        "from http import cookies",
        'value = request.headers.get("cookie")',
        'value = request.headers["Cookie"]',
        'value = scope_headers[b"cookie"]',
        'NAME = "__Host-cbp_session"',
        "from player_backend.site.cookies import SESSION_COOKIE\nvalue = jar[SESSION_COOKIE]\n"
        'other = "__host-cbp_login"',
        "from player_backend.site.cookies import session_cookie_token\n"
        "token = session_cookie_token(request)",
        "from player_backend.site.cookies import login_cookie_token\nread = login_cookie_token",
        "from player_backend.site import cookies\ntoken = cookies.session_cookie_token(request)",
        "from player_backend.site.cookies import session_cookie_token as read\n"
        "token = session_cookie_token(request)",
    ],
)
def test_reading_a_cookie_anywhere_else_fails(snippet: str) -> None:
    assert check_source(snippet, OUTSIDE) != []


@pytest.mark.parametrize(
    "snippet",
    [
        "from player_backend.site.cookies import session_cookie_token\n"
        "def dep(token: Annotated[str | None, Depends(session_cookie_token)]): ...",
        "from player_backend.site.cookies import put_session_cookie\n"
        "put_session_cookie(response, token)",
        'pattern = "(authorization|cookie)"',
    ],
)
def test_using_a_reader_as_a_dependency_and_writing_a_cookie_pass(snippet: str) -> None:
    assert check_source(snippet, OUTSIDE) == []


def test_a_route_that_is_not_listed_fails_the_comparison() -> None:
    # The comparison is of sets, both ways: an unlisted reader and a listed non-reader differ.
    extra = SESSION_COOKIE_ROUTES | {("GET", "/api/player/classes")}
    assert _using(session_cookie_token) != extra
    assert _using(session_cookie_token) != SESSION_COOKIE_ROUTES - {("POST", "/api/site/sign-out")}
