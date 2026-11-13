"""The routed path (route_path_policy.py, #284) agrees with Starlette's router: for every
`root_path` a deployment may set, the path the router matches is the one the headers are
chosen by. The router is asked directly, through a route that echoes what it matched."""

from __future__ import annotations

import ast
import asyncio
import re
from pathlib import Path

import pytest
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route, Router
from starlette.types import Message, Scope

from player_backend.route_path_policy import routed_path

ROOT_PATHS = ("", "/", "/player", "/player/")
PATHS = (
    "/",
    "/player",
    "/player/",
    "/player/api/live/ws",
    "/player/control",
    "/playerx/api/live/ws",
    "/api/live/ws",
    "/control",
    "//api/live/ws",
)


async def _echo(request: Request) -> PlainTextResponse:
    return PlainTextResponse("/" + request.path_params["rest"])


# Every path the router can match; no slash redirect, so an unmatched path is a plain 404.
ROUTER = Router(routes=[Route("/{rest:path}", _echo)], redirect_slashes=False)


def _router_path(path: str, root_path: str) -> str:
    """The path the router matched, or "" when it matched none."""
    messages: list[Message] = []

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    scope: Scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "root_path": root_path,
        "query_string": b"",
        "headers": [],
    }
    asyncio.run(ROUTER(scope, receive, send))
    start = next(m for m in messages if m["type"] == "http.response.start")
    if start["status"] == 404:
        return ""
    assert start["status"] == 200
    return b"".join(
        m.get("body", b"") for m in messages if m["type"] == "http.response.body"
    ).decode()


@pytest.mark.parametrize("root_path", ROOT_PATHS)
@pytest.mark.parametrize("path", PATHS)
def test_the_routed_path_is_the_one_the_router_matches(root_path: str, path: str) -> None:
    assert routed_path(path, root_path) == _router_path(path, root_path)


@pytest.mark.parametrize(
    ("path", "root_path", "routed"),
    [
        ("/api/live/ws", "", "/api/live/ws"),
        ("/api/live/ws", "/", "/api/live/ws"),
        ("/player/api/live/ws", "/player", "/api/live/ws"),
        ("/player", "/player", ""),
        ("/playerx/api/live/ws", "/player", "/playerx/api/live/ws"),
        ("/player/api/live/ws", "/player/", "/player/api/live/ws"),
        ("/api/live/ws", "/player", "/api/live/ws"),
    ],
)
def test_the_prefix_comes_off_at_a_slash_only(path: str, root_path: str, routed: str) -> None:
    assert routed_path(path, root_path) == routed


# `starlette._utils`, `starlette . _x`, also inside a string handed to `importlib`.
_PRIVATE_DOTTED = re.compile(r"\bstarlette\s*\.\s*_")


def _is_starlette(module: str) -> bool:
    return module == "starlette" or module.startswith("starlette.")


def _private_starlette_imports(text: str) -> list[str]:
    """Every private `starlette` module or name the source imports or names (#290)."""
    found = [m.group(0) for m in _PRIVATE_DOTTED.finditer(text)]
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names if _is_starlette(a.name)]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if not _is_starlette(node.module):
                continue
            names = [f"{node.module}.{a.name}" for a in node.names]
        else:
            continue
        found += [n for n in names if any(s.startswith("_") for s in n.split("."))]
    return found


@pytest.mark.parametrize(
    "line",
    [
        "from starlette._utils import get_route_path",
        "import starlette._utils",
        "import starlette._utils as x",
        "import starlette . _utils as x",
        "from starlette import _utils",
        "from starlette import routing, _utils as u",
        "from starlette import (\n    routing,\n    _utils,\n)",
        "from starlette.middleware._x import y",
        "from starlette.routing import _private",
        "importlib.import_module('starlette._utils')",
    ],
)
def test_the_scan_finds_every_form_of_a_private_starlette_import(line: str) -> None:
    assert _private_starlette_imports(line + "\n") != []


@pytest.mark.parametrize(
    "line",
    [
        "from starlette.routing import Route, Router",
        "import starlette.routing as routing",
        "from starlette import status",
        "from mystarlette._x import y",
        "from ._utils import x",
    ],
)
def test_the_scan_leaves_public_imports_alone(line: str) -> None:
    assert _private_starlette_imports(line + "\n") == []


def test_no_source_module_imports_a_private_starlette_module() -> None:
    """The routed path is ours (#284): nothing in the backend leans on `starlette._*`."""
    source = Path(__file__).resolve().parents[1] / "src" / "player_backend"
    files = sorted(source.rglob("*.py"))
    assert files
    found = [p.name for p in files if _private_starlette_imports(p.read_text("utf-8"))]
    assert found == []
