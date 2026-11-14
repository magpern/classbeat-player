"""The rider page at /j (#360; ADR 0007, section 5): served exactly as the companion page at
/control is, with the same headers but for the policy's `connect-src`, its own built files only,
and no path under /j reaching any other file (no database)."""

from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from player_backend import control_page
from player_backend.app import create_app
from player_backend.control_page import RIDER_DIR, load_files
from player_backend.control_page_policy import content_security_policy as control_csp
from player_backend.control_page_policy import control_headers, is_asset_path
from player_backend.response_header_policy import headers_for
from player_backend.rider_page_policy import (
    RIDER_PATH,
    content_security_policy,
    is_rider_path,
    rider_headers,
)
from player_backend.settings import Settings
from tests.pagehelp import send

ORIGIN = "https://player.test"
SETTINGS = Settings(
    database_url="postgresql://player_app:placeholder@127.0.0.1:1/none", site_origin=ORIGIN
)
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
    "img-src 'self'; connect-src https://player.test/api/live/join "
    "wss://player.test/api/live/ws; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'; object-src 'none'"
)
PAGE = b"<!doctype html><title>Join the class</title>"
ASSETS = {
    "rider.js": (b"void 0;", "text/javascript; charset=utf-8"),
    "rider.css": (b"body{}", "text/css; charset=utf-8"),
    "fonts/atkinson-hyperlegible-latin-400-normal.woff2": (b"wOF2", "font/woff2"),
}
COMPANION = b"the companion's script"
SECRET = b"never served"


def _build(root: Path) -> Path:
    """Both phone pages as the web lane's build would write them, plus files never served."""
    rider = root / "dist" / "j"
    (rider / "fonts").mkdir(parents=True)
    (rider / "index.html").write_bytes(PAGE)
    for name, (body, _) in ASSETS.items():
        (rider / name).write_bytes(body)
    control = root / "dist" / "control"
    control.mkdir()
    (control / "index.html").write_bytes(b"<!doctype html><title>Steer the class</title>")
    (control / "companion.js").write_bytes(COMPANION)
    (root / "dist" / "main.js").write_bytes(SECRET)
    (root / "secret.txt").write_bytes(SECRET)
    for name in ("rider.js.map", ".hidden.js", "notes.txt", "copy.html", "Upper.js"):
        (rider / name).write_bytes(SECRET)
    (rider / "fonts" / "deep").mkdir()
    (rider / "fonts" / "deep" / "x.woff2").write_bytes(SECRET)
    os.symlink(root / "secret.txt", rider / "linked.js")
    os.symlink(root / "dist", rider / "out")
    return root / "dist"


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    dist = _build(tmp_path)
    return create_app(
        SETTINGS, live_recheck=None, control_dir=dist / "control", rider_dir=dist / "j"
    )


def _assert_headers(answer: httpx.Response, cache: str) -> None:
    assert answer.headers["content-security-policy"] == CSP
    assert answer.headers["referrer-policy"] == "no-referrer"
    assert answer.headers["x-content-type-options"] == "nosniff"
    assert answer.headers["x-frame-options"] == "DENY"
    assert answer.headers["cache-control"] == cache


def _directives(policy: str) -> dict[str, str]:
    return dict(d.strip().split(" ", 1) for d in policy.split(";"))


# The header table: each kind of path under /j beside the same kind under /control.
HEADER_TABLE = [
    ("/j", "/control"),
    ("/j/", "/control/"),
    ("/j/index.html", "/control/index.html"),
    ("/j/rider.js", "/control/companion.js"),
    ("/j/rider.css", "/control/companion.css"),
    ("/j/fonts/a.woff2", "/control/fonts/a.woff2"),
    ("/j/rider.js.map", "/control/companion.js.map"),
    ("/j/a/b/c.js", "/control/a/b/c.js"),
    ("/j/Upper.js", "/control/Upper.js"),
    ("/j/nothing", "/control/nothing"),
    ("/j/../x.js", "/control/../x.js"),
]


@pytest.mark.parametrize(("rider", "control"), HEADER_TABLE)
def test_the_headers_equal_the_companions_but_for_what_the_page_connects_to(
    rider: str, control: str
) -> None:
    ours = rider_headers(rider, ORIGIN)
    theirs = control_headers(control, ORIGIN)
    assert ours == {**theirs, "Content-Security-Policy": CSP}, rider
    assert is_asset_path(rider, RIDER_PATH) == (theirs["Cache-Control"] == "no-cache"), rider
    # Every directive is the companion's but connect-src, which names fewer places.
    mine, other = _directives(CSP), _directives(control_csp(ORIGIN))
    assert mine.keys() == other.keys()
    assert {k: v for k, v in mine.items() if k != "connect-src"} == {
        k: v for k, v in other.items() if k != "connect-src"
    }
    # The same live socket as the companion's; the join route in place of its three routes.
    socket = [s for s in other["connect-src"].split() if s.startswith("wss://")]
    assert mine["connect-src"].split() == [ORIGIN + "/api/live/join", *socket]


def test_the_headers_by_path() -> None:
    page = rider_headers("/j", ORIGIN)
    assert page == {
        "Content-Security-Policy": CSP,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Cache-Control": "no-store",
    }
    assert rider_headers("/j/", ORIGIN) == page
    assert rider_headers("/j/index.html", ORIGIN) == page
    assert rider_headers("/j/fonts/a.woff2", ORIGIN) == {**page, "Cache-Control": "no-cache"}


def test_the_policy_connects_only_to_the_join_route_and_the_live_endpoint() -> None:
    policy = content_security_policy("https://site.test:8443")
    directives = _directives(policy)
    assert directives["connect-src"].split() == [
        "https://site.test:8443/api/live/join",
        "wss://site.test:8443/api/live/ws",
    ]
    assert directives["default-src"] == "'none'"
    assert directives["frame-ancestors"] == "'none'"
    assert "unsafe" not in policy and "*" not in policy and "data:" not in policy
    for value in directives.values():
        for source in value.split():
            assert source.startswith(("'", "https://site.test:8443/", "wss://site.test:8443/"))


def test_which_paths_are_the_pages() -> None:
    for path in ("/j", "/j/", "/j/rider.js", "/j/fonts/a.woff2"):
        assert is_rider_path(path), path
    for path in ("/", "/join", "/jx", "/js", "/api/live/join", "/x/j", "/J"):
        assert not is_rider_path(path), path


def test_the_page_is_served_at_j_with_every_header(app: FastAPI) -> None:
    for path in ("/j", "/j/"):
        answer = send(app, "GET", path)
        assert answer.status_code == 200, path
        assert answer.content == PAGE
        assert answer.headers["content-type"] == "text/html; charset=utf-8"
        _assert_headers(answer, "no-store")
    # GET only, as /control: HEAD is a 405 with every header.
    head = send(app, "HEAD", "/j")
    assert head.status_code == 405
    _assert_headers(head, "no-store")
    assert send(app, "HEAD", "/control").status_code == 405


@pytest.mark.parametrize("name", sorted(ASSETS))
def test_each_asset_is_served_with_its_type_and_every_header(app: FastAPI, name: str) -> None:
    body, media_type = ASSETS[name]
    answer = send(app, "GET", "/j/" + name)
    assert answer.status_code == 200
    assert answer.content == body
    assert answer.headers["content-type"] == media_type
    _assert_headers(answer, "no-cache")


@pytest.mark.parametrize(
    "path",
    [
        "/j/index.html",  # the page only at /j
        "/j/nothing.js",
        "/j/rider.js.map",
        "/j/.hidden.js",
        "/j/notes.txt",
        "/j/copy.html",
        "/j/Upper.js",
        "/j/RIDER.JS",
        "/j/rider.js/",
        "/j//rider.js",
        "/j/fonts",
        "/j/fonts/",
        "/j/fonts/deep/x.woff2",
        "/j/linked.js",
        "/j/out/main.js",
        "/j/../main.js",
        "/j/../control/companion.js",
        "/j/%2e%2e/control/companion.js",
        "/j/..%2fmain.js",
        "/j/fonts/../rider.js",
        "/j/./rider.js",
        "/j/companion.js",  # the companion's files are never under /j
        "/j/control/companion.js",
        "/j/main.js",
        "/j/healthz",
        "/j/api/live/join",
    ],
)
def test_an_unknown_path_under_j_is_a_404_with_every_header(app: FastAPI, path: str) -> None:
    answer = send(app, "GET", path)
    assert answer.status_code == 404, path
    assert answer.json() == {"error": "not_found"}
    assert SECRET not in answer.content and COMPANION not in answer.content
    assert answer.headers["content-security-policy"] == CSP
    assert answer.headers["referrer-policy"] == "no-referrer"
    assert answer.headers["x-content-type-options"] == "nosniff"
    assert answer.headers["x-frame-options"] == "DENY"


def test_another_method_is_refused_with_every_header(app: FastAPI) -> None:
    for method in ("POST", "PUT", "DELETE", "PATCH"):
        for path in ("/j", "/j/rider.js", "/j/nothing"):
            answer = send(app, method, path)
            assert answer.status_code == 405, (method, path)
            _assert_headers(answer, "no-cache" if path.endswith(".js") else "no-store")


def test_the_companion_page_keeps_its_own_files_and_headers(app: FastAPI) -> None:
    answer = send(app, "GET", "/control/companion.js")
    assert answer.status_code == 200 and answer.content == COMPANION
    assert answer.headers["content-security-policy"] == control_csp(ORIGIN)
    assert send(app, "GET", "/control/rider.js").status_code == 404


@pytest.mark.parametrize("root_path", ["/player", "/"])
def test_under_a_path_prefix_the_page_keeps_its_headers(app: FastAPI, root_path: str) -> None:
    answer = send(app, "GET", "/j", root_path=root_path)
    assert answer.status_code == 200 and answer.content == PAGE
    _assert_headers(answer, "no-store")
    asset = send(app, "GET", "/j/rider.js", root_path=root_path)
    assert asset.status_code == 200
    _assert_headers(asset, "no-cache")
    missing = send(app, "GET", "/j/nothing.js", root_path=root_path)
    assert missing.status_code == 404
    _assert_headers(missing, "no-cache")
    assert headers_for("/player/j", "/player", ORIGIN) == rider_headers("/j", ORIGIN)


def test_a_rider_asset_under_an_api_prefix_is_never_stored() -> None:
    """`root_path="/api/live"` routes `/api/live/j/x.js` as the page's script; the full path is
    the live API's, so the weaker `no-cache` gives way to `no-store`."""
    headers = headers_for("/api/live/j/rider.js", "/api/live", ORIGIN)
    assert headers == {**rider_headers("/j/rider.js", ORIGIN), "Cache-Control": "no-store"}


def test_a_500_under_j_carries_every_header(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(_served: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(control_page, "_answer", broken)
    for path, cache in (("/j", "no-store"), ("/j/rider.js", "no-cache")):
        answer = send(app, "GET", path)
        assert answer.status_code == 500, path
        assert answer.json() == {"error": "internal_error"}
        _assert_headers(answer, cache)


def test_without_a_built_page_j_is_a_404(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    app = create_app(SETTINGS, live_recheck=None, rider_dir=tmp_path / "missing")
    # The app's logging writes JSON lines to standard output (logging_setup.py).
    assert '"message":"rider page not built"' in capsys.readouterr().out
    for path in ("/j", "/j/rider.js"):
        answer = send(app, "GET", path)
        assert answer.status_code == 404
        assert answer.headers["content-security-policy"] == CSP


def test_a_linked_folder_is_not_served(tmp_path: Path) -> None:
    dist = _build(tmp_path / "real")
    os.symlink(dist / "j", tmp_path / "link")
    app = create_app(SETTINGS, live_recheck=None, rider_dir=tmp_path / "link")
    assert send(app, "GET", "/j").status_code == 404
    assert send(app, "GET", "/j/rider.js").status_code == 404


def test_only_the_allowed_files_are_loaded(tmp_path: Path) -> None:
    files = load_files(_build(tmp_path) / "j", "rider")
    assert files.page is not None and files.page.body == PAGE
    assert sorted(files.assets) == sorted(ASSETS)


def test_other_paths_keep_the_sites_headers(app: FastAPI) -> None:
    for path in ("/healthz", "/join", "/jx", "/api/live/join"):
        answer = send(app, "GET", path)
        assert answer.headers["content-security-policy"] not in (CSP, control_csp(ORIGIN)), path
        assert "x-frame-options" not in answer.headers, path


def test_the_default_folder_is_the_web_lanes_build() -> None:
    assert RIDER_DIR.parts[-3:] == ("web", "dist", "j")
    assert (RIDER_DIR.parents[1] / "build.mjs").is_file()


def test_the_real_build_is_served_whole() -> None:
    """When the web lane's rider page is built here, every file its build writes is served."""
    if not (RIDER_DIR / "index.html").is_file():
        pytest.skip("web/dist/j is not built (npm run build in web/)")
    app = create_app(SETTINGS, live_recheck=None)
    files = [p.relative_to(RIDER_DIR).as_posix() for p in RIDER_DIR.rglob("*") if p.is_file()]
    for name in files:
        path = "/j" if name == "index.html" else "/j/" + name
        answer = send(app, "GET", path)
        assert answer.status_code == 200, name
        assert answer.content == (RIDER_DIR / name).read_bytes()
