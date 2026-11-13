"""Serves the handlebar companion page, the web lane's built `dist/control/`, at `/control`.

The built files are read once, when the app is made, into a table keyed by their path inside
the folder (control_page_policy.asset_type decides which go in). A request is answered from
that table by exact key: nothing is looked up on disk per request, so no path a client sends
reaches another file, and anything not in the table is a 404. Symbolic links are not followed.
The headers are set for every answer under `/control` by the app's middleware (app.py).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from fastapi import APIRouter, Response

from player_backend.control_page_policy import CONTROL_PATH, PAGE_FILE, PAGE_TYPE, asset_type
from player_backend.http_errors import ApiError

# backend/src/player_backend/ -> the repository's root, where the web lane builds the page.
CONTROL_DIR: Final = Path(__file__).resolve().parents[3] / "web" / "dist" / "control"

_log = logging.getLogger("player_backend.control_page")


@dataclass(frozen=True)
class Served:
    body: bytes
    media_type: str


@dataclass(frozen=True)
class ControlFiles:
    page: Served | None
    assets: dict[str, Served]


def _regular(path: Path) -> bool:
    return path.is_file() and not path.is_symlink()


def load_files(folder: Path) -> ControlFiles:
    """The built page and its assets. A folder that is missing gives an empty table."""
    if not folder.is_dir() or folder.is_symlink():
        _log.warning("control page not built")
        return ControlFiles(page=None, assets={})
    page_file = folder / PAGE_FILE
    page = Served(page_file.read_bytes(), PAGE_TYPE) if _regular(page_file) else None
    assets: dict[str, Served] = {}
    for path in sorted(folder.rglob("*")):
        relative = path.relative_to(folder)
        media_type = asset_type(relative.as_posix())
        # Each folder on the way must be a real folder too, not a link out of the tree.
        inside = all(not (folder / p).is_symlink() for p in relative.parents)
        if media_type is not None and inside and _regular(path):
            assets[relative.as_posix()] = Served(path.read_bytes(), media_type)
    return ControlFiles(page=page, assets=assets)


def _answer(served: Served | None) -> Response:
    if served is None:
        raise ApiError(404, "not_found")
    return Response(served.body, media_type=served.media_type)


def control_router(files: ControlFiles) -> APIRouter:
    router = APIRouter()

    @router.api_route(CONTROL_PATH, methods=["GET", "HEAD"])
    def page() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _answer(files.page)

    # Every other path under /control ends here, found or not: it never reaches another route.
    @router.api_route(CONTROL_PATH + "/{name:path}", methods=["GET", "HEAD"])
    def asset(name: str) -> Response:  # pyright: ignore[reportUnusedFunction]
        return _answer(files.page if name == "" else files.assets.get(name))

    return router
