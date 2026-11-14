"""Serves the web lane's built phone pages: the handlebar companion, `dist/control/`, at
`/control` (ADR 0005, section 8), and the rider page, `dist/j/`, at `/j` (ADR 0007, section 5).

Each page's built files are read once, when the app is made, into a table keyed by their path inside
the folder (control_page_policy.asset_type decides which go in). A request is answered from
that table by exact key: nothing is looked up on disk per request, so no path a client sends
reaches another file, and anything not in the table is a 404. Symbolic links are not followed.
The headers are set for every answer under `/control` and `/j` by the app's middleware (app.py).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from fastapi import APIRouter, Response

from player_backend.control_page_policy import CONTROL_PATH, PAGE_FILE, PAGE_TYPE, asset_type
from player_backend.http_errors import ApiError
from player_backend.rider_page_policy import RIDER_PATH

# backend/src/player_backend/ -> the repository's root, where the web lane builds the pages.
_WEB_DIST: Final = Path(__file__).resolve().parents[3] / "web" / "dist"
CONTROL_DIR: Final = _WEB_DIST / "control"
RIDER_DIR: Final = _WEB_DIST / "j"

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


def under_real_folders(folder: Path, relative: Path) -> bool:
    """Whether each folder between `folder` and the file at `relative` is a real folder, not a
    link out of the tree. Kept although `rglob` does not enter linked folders on Python 3.12:
    the check does not rest on how a walk treats links."""
    return all(not (folder / p).is_symlink() for p in relative.parents)


def load_files(folder: Path, page_name: str = "control") -> ControlFiles:
    """The built page and its assets. A folder that is missing gives an empty table.

    `page_name` (`control` or `rider`) names the page in the warning when it is not built.
    """
    if not folder.is_dir() or folder.is_symlink():
        _log.warning("%s page not built", page_name)
        return ControlFiles(page=None, assets={})
    page_file = folder / PAGE_FILE
    page = Served(page_file.read_bytes(), PAGE_TYPE) if _regular(page_file) else None
    assets: dict[str, Served] = {}
    for path in sorted(folder.rglob("*")):
        relative = path.relative_to(folder)
        media_type = asset_type(relative.as_posix())
        if media_type is not None and under_real_folders(folder, relative) and _regular(path):
            assets[relative.as_posix()] = Served(path.read_bytes(), media_type)
    return ControlFiles(page=page, assets=assets)


def _answer(served: Served | None) -> Response:
    if served is None:
        raise ApiError(404, "not_found")
    return Response(served.body, media_type=served.media_type)


def page_router(base: str, files: ControlFiles) -> APIRouter:
    """The page at `base` and its files under `base/`, GET only: any other method is a 405."""
    router = APIRouter()

    @router.api_route(base, methods=["GET"])
    def page() -> Response:  # pyright: ignore[reportUnusedFunction]
        return _answer(files.page)

    # Every other path under the page ends here, found or not: it never reaches another route.
    @router.api_route(base + "/{name:path}", methods=["GET"])
    def asset(name: str) -> Response:  # pyright: ignore[reportUnusedFunction]
        return _answer(files.page if name == "" else files.assets.get(name))

    return router


def control_router(files: ControlFiles) -> APIRouter:
    return page_router(CONTROL_PATH, files)


def rider_router(files: ControlFiles) -> APIRouter:
    return page_router(RIDER_PATH, files)
