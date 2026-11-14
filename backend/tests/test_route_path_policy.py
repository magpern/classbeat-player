"""The routed path (route_path_policy.py, #284) agrees with Starlette's router: for every
`root_path` a deployment may set, the path the router matches is the one the headers are
chosen by. The router is asked directly, through a route that echoes what it matched. That no
source module imports a private Starlette module is a guard of its own
(tests/guards/test_guard_private_imports.py)."""

from __future__ import annotations

import asyncio

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
