"""Serves the site's download page (`/download`), its release data (`/releases.json`) and the two
files the page loads (`/site.js`, `/site.css`).

Both are built into `web/dist/site/` (web/build.mjs; docs/design/download.md). They are public and
depend on no account: nothing here reads a cookie or a token. The four files are read once, when the
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
# The fixed list: served path -> (built file, media type). No path from a request reaches the disk.
FILES: Final = {
    "/download": ("index.html", "text/html; charset=utf-8"),
    "/releases.json": ("releases.json", "application/json"),
    "/site.js": ("site.js", "text/javascript; charset=utf-8"),
    "/site.css": ("site.css", "text/css; charset=utf-8"),
}

_log = logging.getLogger("player_backend.pages")


def _read(folder: Path, name: str, media_type: str) -> Served | None:
    path = folder / name
    if folder.is_symlink() or not path.is_file() or path.is_symlink():
        _log.warning("site file %s not built", name)
        return None
    return Served(path.read_bytes(), media_type)


def download_router(folder: Path = SITE_DIR) -> APIRouter:
    """GET only: any other method is a 405. A file that is not built answers 404."""
    router = APIRouter()
    for url, (name, media_type) in FILES.items():
        served = _read(folder, name, media_type)

        def answer(served: Served | None = served) -> Response:
            if served is None:
                return Response(status_code=404)
            return Response(
                served.body, media_type=served.media_type, headers={"Cache-Control": "no-cache"}
            )

        router.add_api_route(url, answer, methods=["GET"])
    return router
