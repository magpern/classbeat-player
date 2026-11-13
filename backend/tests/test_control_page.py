"""The companion page at /control (#266; ADR 0005, section 8): every header on the page, its
assets and its refusals, and no path under /control reaching any other file (no database)."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import unquote

import httpx
import pytest
from fastapi import FastAPI
from starlette.types import Message, Scope

from player_backend import control_page
from player_backend.app import create_app
from player_backend.control_page import CONTROL_DIR, load_files, under_real_folders
from player_backend.control_page_policy import (
    asset_type,
    content_security_policy,
    control_headers,
    is_control_path,
)
from player_backend.settings import Settings

ORIGIN = "https://player.test"
SETTINGS = Settings(
    database_url="postgresql://player_app:placeholder@127.0.0.1:1/none", site_origin=ORIGIN
)
CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; "
    "img-src 'self'; connect-src https://player.test/api/live/controller "
    "https://player.test/api/live/control https://player.test/api/site/sessions "
    "wss://player.test/api/live/ws; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'; object-src 'none'"
)
PAGE = b"<!doctype html><title>Steer the class</title>"
ASSETS = {
    "companion.js": (b"void 0;", "text/javascript; charset=utf-8"),
    "companion.css": (b"body{}", "text/css; charset=utf-8"),
    "fonts/atkinson-hyperlegible-latin-400-normal.woff2": (b"wOF2", "font/woff2"),
}
SECRET = b"never served"


def _build(root: Path) -> Path:
    """A built page as web/build.mjs writes it, plus files that must never be served."""
    control = root / "dist" / "control"
    (control / "fonts").mkdir(parents=True)
    (control / "index.html").write_bytes(PAGE)
    for name, (body, _) in ASSETS.items():
        (control / name).write_bytes(body)
    # Beside the page: the room screen's files and a secret, outside the served folder.
    (root / "dist" / "main.js").write_bytes(SECRET)
    (root / "secret.txt").write_bytes(SECRET)
    # Inside it, but of a kind or a place that is not served.
    for name in ("companion.js.map", ".hidden.js", "notes.txt", "copy.html", "Upper.js"):
        (control / name).write_bytes(SECRET)
    (control / "fonts" / "deep").mkdir()
    (control / "fonts" / "deep" / "x.woff2").write_bytes(SECRET)
    os.symlink(root / "secret.txt", control / "linked.js")
    os.symlink(root / "dist", control / "out")
    return control


def _send(app: FastAPI, method: str, raw_path: str, root_path: str = "") -> httpx.Response:
    """The request as a server hands it over: the path decoded, never normalised, so `..`,
    `.` and escapes reach the app as they were sent (an HTTP client would tidy them)."""
    messages: list[Message] = []
    # The path holds the prefix, as servers hand it over; a `/` prefix adds no second slash.
    prefix = root_path.rstrip("/")

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": prefix + unquote(raw_path),
        "raw_path": (prefix + raw_path).encode(),
        "root_path": root_path,
        "query_string": b"",
        "headers": [(b"host", b"player.test")],
        "client": ("198.51.100.9", 40000),
        "server": ("player.test", 443),
    }
    asyncio.run(app(scope, receive, send))
    start = next(m for m in messages if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    headers = [(k.decode(), v.decode()) for k, v in start["headers"]]
    return httpx.Response(start["status"], headers=headers, content=body)


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return create_app(SETTINGS, live_recheck=None, control_dir=_build(tmp_path))


def _assert_headers(answer: httpx.Response, cache: str) -> None:
    assert answer.headers["content-security-policy"] == CSP
    assert answer.headers["referrer-policy"] == "no-referrer"
    assert answer.headers["x-content-type-options"] == "nosniff"
    assert answer.headers["x-frame-options"] == "DENY"
    assert answer.headers["cache-control"] == cache


def test_the_page_is_served_at_control_with_every_header(app: FastAPI) -> None:
    for path in ("/control", "/control/"):
        answer = _send(app, "GET", path)
        assert answer.status_code == 200, path
        assert answer.content == PAGE
        assert answer.headers["content-type"] == "text/html; charset=utf-8"
        _assert_headers(answer, "no-store")
    # GET only: any other method is a 405 (test_another_method_is_refused_with_every_header).
    head = _send(app, "HEAD", "/control")
    assert head.status_code == 405
    _assert_headers(head, "no-store")


@pytest.mark.parametrize("name", sorted(ASSETS))
def test_each_asset_is_served_with_its_type_and_every_header(app: FastAPI, name: str) -> None:
    body, media_type = ASSETS[name]
    answer = _send(app, "GET", "/control/" + name)
    assert answer.status_code == 200
    assert answer.content == body
    assert answer.headers["content-type"] == media_type
    _assert_headers(answer, "no-cache")


@pytest.mark.parametrize(
    "path",
    [
        "/control/index.html",  # the page only at /control
        "/control/nothing.js",
        "/control/companion.js.map",
        "/control/.hidden.js",
        "/control/notes.txt",
        "/control/copy.html",
        "/control/Upper.js",
        "/control/COMPANION.JS",
        "/control/companion.js/",
        "/control//companion.js",
        "/control/fonts",
        "/control/fonts/",
        "/control/fonts/deep/x.woff2",
        "/control/linked.js",
        "/control/out/main.js",
        "/control/../main.js",
        "/control/../../secret.txt",
        "/control/%2e%2e/main.js",
        "/control/..%2fmain.js",
        "/control/fonts/../companion.js",
        "/control/./companion.js",
        "/control/%63ompanion.js.map",
        "/control/main.js",
        "/control/healthz",
        "/control/api/site/sessions",
    ],
)
def test_an_unknown_path_under_control_is_a_404_with_every_header(app: FastAPI, path: str) -> None:
    answer = _send(app, "GET", path)
    assert answer.status_code == 404, path
    assert answer.json() == {"error": "not_found"}
    assert SECRET not in answer.content
    assert answer.headers["content-security-policy"] == CSP
    assert answer.headers["x-content-type-options"] == "nosniff"
    assert answer.headers["x-frame-options"] == "DENY"


def test_another_method_is_refused_with_every_header(app: FastAPI) -> None:
    for path in ("/control", "/control/companion.js", "/control/nothing"):
        answer = _send(app, "POST", path)
        assert answer.status_code == 405, path
        _assert_headers(answer, "no-cache" if path.endswith(".js") else "no-store")


def test_under_a_path_prefix_the_page_keeps_its_headers(app: FastAPI) -> None:
    answer = _send(app, "GET", "/control", root_path="/player")
    assert answer.status_code == 200 and answer.content == PAGE
    _assert_headers(answer, "no-store")
    missing = _send(app, "GET", "/control/nothing.js", root_path="/player")
    assert missing.status_code == 404
    _assert_headers(missing, "no-cache")


def test_under_the_root_prefix_the_page_keeps_its_headers(app: FastAPI) -> None:
    """`root_path="/"` is taken off at a `/` boundary only, as the router does (#279)."""
    answer = _send(app, "GET", "/control", root_path="/")
    assert answer.status_code == 200 and answer.content == PAGE
    _assert_headers(answer, "no-store")
    asset = _send(app, "GET", "/control/companion.js", root_path="/")
    assert asset.status_code == 200
    _assert_headers(asset, "no-cache")
    other = _send(app, "GET", "/healthz", root_path="/")
    assert other.headers["content-security-policy"] != CSP


def test_a_500_under_control_carries_every_header(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(_served: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(control_page, "_answer", broken)
    for path, cache in (("/control", "no-store"), ("/control/companion.js", "no-cache")):
        answer = _send(app, "GET", path)
        assert answer.status_code == 500, path
        assert answer.json() == {"error": "internal_error"}
        _assert_headers(answer, cache)


def test_the_real_build_is_served_whole() -> None:
    """When the web lane's page is built here, every file its build writes is served."""
    if not (CONTROL_DIR / "index.html").is_file():
        pytest.skip("web/dist/control is not built (npm run build in web/)")
    app = create_app(SETTINGS, live_recheck=None)
    files = [p.relative_to(CONTROL_DIR).as_posix() for p in CONTROL_DIR.rglob("*") if p.is_file()]
    assert "companion.js" in files and "companion.css" in files
    for name in files:
        path = "/control" if name == "index.html" else "/control/" + name
        answer = _send(app, "GET", path)
        assert answer.status_code == 200, name
        assert answer.content == (CONTROL_DIR / name).read_bytes()


def test_without_a_built_page_control_is_a_404(tmp_path: Path) -> None:
    app = create_app(SETTINGS, live_recheck=None, control_dir=tmp_path / "missing")
    for path in ("/control", "/control/companion.js"):
        answer = _send(app, "GET", path)
        assert answer.status_code == 404
        assert answer.headers["content-security-policy"] == CSP


def test_a_linked_folder_is_not_served(tmp_path: Path) -> None:
    real = _build(tmp_path / "real")
    os.symlink(real, tmp_path / "link")
    app = create_app(SETTINGS, live_recheck=None, control_dir=tmp_path / "link")
    assert _send(app, "GET", "/control").status_code == 404
    assert _send(app, "GET", "/control/companion.js").status_code == 404


def _walk_into_links(self: Path, pattern: str) -> Iterator[Path]:
    """`rglob("*")` as a walk that does enter linked folders (Python 3.13 can be asked to)."""
    assert pattern == "*"
    for top, folders, files in os.walk(self, followlinks=True):
        for name in [*folders, *files]:
            yield Path(top) / name


def test_a_file_in_a_linked_folder_inside_is_not_served(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The per-folder link check, alone: even a walk that enters `out/` (a link to `dist/`, whose
    `main.js` has a served name and type) serves nothing from it (#279)."""
    control = _build(tmp_path)
    monkeypatch.setattr(Path, "rglob", _walk_into_links)
    assert (control / "out" / "main.js") in set(control.rglob("*"))
    files = load_files(control)
    assert sorted(files.assets) == sorted(ASSETS)
    assert all(SECRET != served.body for served in files.assets.values())


def test_which_folders_on_the_way_are_real(tmp_path: Path) -> None:
    control = _build(tmp_path)
    assert under_real_folders(control, Path("companion.js"))
    assert under_real_folders(control, Path("fonts/a.woff2"))
    assert not under_real_folders(control, Path("out/main.js"))
    assert not under_real_folders(control, Path("out/deep/main.js"))


def test_other_paths_keep_the_sites_headers(app: FastAPI) -> None:
    for path in ("/healthz", "/controller", "/controls", "/api/live/control"):
        answer = _send(app, "GET", path)
        assert answer.headers["content-security-policy"] != CSP, path
        assert "x-frame-options" not in answer.headers, path


def test_the_default_folder_is_the_web_lanes_build() -> None:
    assert CONTROL_DIR.parts[-3:] == ("web", "dist", "control")
    assert (CONTROL_DIR.parents[2] / "web" / "build.mjs").is_file()


@pytest.mark.parametrize(
    ("relative", "expected"),
    [
        ("companion.js", "text/javascript; charset=utf-8"),
        ("companion.css", "text/css; charset=utf-8"),
        ("fonts/big-shoulders-display-latin-800-normal.woff2", "font/woff2"),
        ("index.html", None),
        ("companion.js.map", None),
        ("a.mjs", None),
        (".js", None),
        ("-a.js", None),
        ("A.js", None),
        ("a..js", None),
        ("..", None),
        ("../a.js", None),
        ("fonts/../a.js", None),
        ("fonts/deep/a.woff2", None),
        ("fonts/", None),
        ("", None),
        ("a b.js", None),
        ("a.js\n", None),
        ("noext", None),
    ],
)
def test_which_built_files_are_served(relative: str, expected: str | None) -> None:
    assert asset_type(relative) == expected


def test_which_paths_are_the_pages() -> None:
    assert is_control_path("/control")
    assert is_control_path("/control/")
    assert is_control_path("/control/fonts/a.woff2")
    for path in ("/", "/controller", "/controls", "/api/live/control", "/x/control"):
        assert not is_control_path(path)


def test_the_policy_connects_only_to_the_live_endpoint_and_the_api() -> None:
    policy = content_security_policy("https://site.test:8443")
    directives = dict(d.strip().split(" ", 1) for d in policy.split(";"))
    assert directives["connect-src"].split() == [
        "https://site.test:8443/api/live/controller",
        "https://site.test:8443/api/live/control",
        "https://site.test:8443/api/site/sessions",
        "wss://site.test:8443/api/live/ws",
    ]
    assert directives["default-src"] == "'none'"
    assert directives["frame-ancestors"] == "'none'"
    assert "unsafe" not in policy and "*" not in policy and "data:" not in policy
    # Only the site's own origin is ever named.
    for value in directives.values():
        for source in value.split():
            assert source.startswith(("'", "https://site.test:8443/", "wss://site.test:8443/"))


def test_the_headers_by_path() -> None:
    page = control_headers("/control", ORIGIN)
    assert page == {
        "Content-Security-Policy": CSP,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Cache-Control": "no-store",
    }
    assert control_headers("/control/", ORIGIN) == page
    assert control_headers("/control/index.html", ORIGIN) == page
    assert control_headers("/control/fonts/a.woff2", ORIGIN) == {
        **page,
        "Cache-Control": "no-cache",
    }
