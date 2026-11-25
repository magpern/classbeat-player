"""The site's /download page and /releases.json (#794): served from the built site folder with the
site's page headers, no account involved, nothing else reachable (no database, no network)."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from player_backend.app import create_app
from player_backend.request_policy import CONTENT_SECURITY_POLICY
from player_backend.settings import Settings
from tests.pagehelp import send

SETTINGS = Settings(
    database_url="postgresql://player_app:placeholder@127.0.0.1:1/none",
    site_origin="https://player.test",
)
PAGE = b"<!doctype html><title>Class player</title>"
RELEASES = b'{\n  "release": null\n}\n'
SECRET = b"never served"


def _app(tmp_path: Path, built: bool = True) -> FastAPI:
    site = tmp_path / "site"
    site.mkdir()
    if built:
        (site / "index.html").write_bytes(PAGE)
        (site / "releases.json").write_bytes(RELEASES)
    (site / "secret.txt").write_bytes(SECRET)
    return create_app(
        SETTINGS, control_dir=tmp_path / "none", rider_dir=tmp_path / "none", site_dir=site
    )


def _page_headers_hold(headers: dict[str, str]) -> None:
    assert headers["content-security-policy"] == CONTENT_SECURITY_POLICY
    assert headers["referrer-policy"] == "no-referrer"
    assert headers["cache-control"] == "no-cache"


def test_download_page(tmp_path: Path) -> None:
    response = send(_app(tmp_path), "GET", "/download")
    assert response.status_code == 200
    assert response.content == PAGE
    assert response.headers["content-type"] == "text/html; charset=utf-8"
    _page_headers_hold(dict(response.headers))


def test_releases_json(tmp_path: Path) -> None:
    response = send(_app(tmp_path), "GET", "/releases.json")
    assert response.status_code == 200
    assert response.content == RELEASES
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"release": None}
    _page_headers_hold(dict(response.headers))


def test_no_account_needed(tmp_path: Path) -> None:
    app = _app(tmp_path)
    for path in ("/download", "/releases.json"):
        response = send(app, "GET", path)
        assert response.status_code == 200
        assert "set-cookie" not in response.headers


def test_unknown_paths_are_404(tmp_path: Path) -> None:
    app = _app(tmp_path)
    for path in ("/download/x", "/downloads", "/secret.txt", "/releases.json/x"):
        response = send(app, "GET", path)
        assert response.status_code == 404, path
        assert SECRET not in response.content
        assert response.headers["content-security-policy"] == CONTENT_SECURITY_POLICY


def test_only_get(tmp_path: Path) -> None:
    app = _app(tmp_path)
    for path in ("/download", "/releases.json"):
        assert send(app, "POST", path).status_code == 405


def test_not_built_is_404(tmp_path: Path) -> None:
    app = _app(tmp_path, built=False)
    for path in ("/download", "/releases.json"):
        assert send(app, "GET", path).status_code == 404
