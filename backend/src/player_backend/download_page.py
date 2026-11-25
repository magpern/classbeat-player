"""Serves the site's download page (`/download`) and its release data (`/releases.json`).

Both are built into `web/dist/site/` (web/build.mjs; docs/design/download.md). They are public and
depend on no account: nothing here reads a cookie or a token. The two files are read once, when the
app is made, and answered from memory, so no request path reaches the disk. Any other path is a 404
from the app. The headers are the site's page headers, set for every answer by the app's
middleware (app.py); both answers are revalidated, so a new release shows without a stale copy.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Final

from fastapi import APIRouter, Response

from player_backend.control_page import Served

# backend/src/player_backend/ -> the repository's root, where the web lane builds the site.
SITE_DIR: Final = Path(__file__).resolve().parents[3] / "web" / "dist" / "site"
DOWNLOAD_PATH: Final = "/download"
RELEASES_PATH: Final = "/releases.json"
_PAGE_TYPE: Final = "text/html; charset=utf-8"
_JSON_TYPE: Final = "application/json"

_log = logging.getLogger("player_backend.pages")


def _read(folder: Path, name: str, media_type: str) -> Served | None:
    path = folder / name
    if folder.is_symlink() or not path.is_file() or path.is_symlink():
        _log.warning("site file %s not built", name)
        return None
    return Served(path.read_bytes(), media_type)


def download_router(folder: Path = SITE_DIR) -> APIRouter:
    """GET only: any other method is a 405. A file that is not built answers 404."""
    page = _read(folder, "index.html", _PAGE_TYPE)
    releases = _read(folder, "releases.json", _JSON_TYPE)
    router = APIRouter()

    def answer(served: Served | None) -> Response:
        if served is None:
            return Response(status_code=404)
        return Response(
            served.body, media_type=served.media_type, headers={"Cache-Control": "no-cache"}
        )

    @router.api_route(DOWNLOAD_PATH, methods=["GET"])
    def download() -> Response:  # pyright: ignore[reportUnusedFunction]
        return answer(page)

    @router.api_route(RELEASES_PATH, methods=["GET"])
    def release_data() -> Response:  # pyright: ignore[reportUnusedFunction]
        return answer(releases)

    return router
