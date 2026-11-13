"""Under a path prefix, `root_path`, every response gets the headers of the path the router
matched (#284; ADR 0002, section 5): the APIs that carry tokens or data stay `no-store`, and a
path that only looks like an API once the prefix is wrongly taken off does not (no database)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from starlette.types import Message, Scope

from player_backend.app import create_app
from player_backend.request_policy import CONTENT_SECURITY_POLICY
from player_backend.settings import Settings

SETTINGS = Settings(
    database_url="postgresql://player_app:placeholder@127.0.0.1:1/none",
    site_origin="https://player.test",
)
# Unknown paths under each never-stored prefix: answered 404 by the router, with the headers.
NEVER_STORED = (
    "/api/site/nothing",
    "/api/pairing/nothing",
    "/api/player/nothing",
    "/api/source/nothing",
    "/api/live/nothing",
)


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return create_app(SETTINGS, live_recheck=None, control_dir=tmp_path / "missing")


def _send(app: FastAPI, path: str, root_path: str) -> httpx.Response:
    """A GET as a server hands it over under `root_path`: the path holds the prefix."""
    messages: list[Message] = []

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": path,
        "raw_path": path.encode(),
        "root_path": root_path,
        "query_string": b"",
        "headers": [(b"host", b"player.test")],
        "client": ("198.51.100.9", 40000),
        "server": ("player.test", 443),
    }
    asyncio.run(app(scope, receive, send))
    start = next(m for m in messages if m["type"] == "http.response.start")
    headers = [(k.decode(), v.decode()) for k, v in start["headers"]]
    return httpx.Response(start["status"], headers=headers)


@pytest.mark.parametrize("root_path", ["", "/player"])
@pytest.mark.parametrize("api", NEVER_STORED)
def test_the_apis_are_never_stored_under_a_prefix(app: FastAPI, root_path: str, api: str) -> None:
    answer = _send(app, root_path + api, root_path)
    assert answer.status_code == 404
    assert answer.headers["cache-control"] == "no-store"
    assert answer.headers["content-security-policy"] == CONTENT_SECURITY_POLICY
    assert answer.headers["referrer-policy"] == "no-referrer"


@pytest.mark.parametrize("api", NEVER_STORED)
def test_a_prefix_that_starts_an_api_path_keeps_no_store(app: FastAPI, api: str) -> None:
    """Under `root_path="/api"` the router matches `/live/...`; the full path is still an API's
    (#290), so the answer is never stored."""
    answer = _send(app, api, "/api")
    assert answer.status_code == 404
    assert answer.headers["cache-control"] == "no-store"
    assert answer.headers["content-security-policy"] == CONTENT_SECURITY_POLICY
    assert answer.headers["referrer-policy"] == "no-referrer"


def test_a_path_the_router_does_not_strip_keeps_the_page_headers(app: FastAPI) -> None:
    """`/playerx/...` is not under `/player`: the router routes it whole, and so do the headers."""
    answer = _send(app, "/playerx/api/live/nothing", "/player")
    assert answer.status_code == 404
    assert "cache-control" not in answer.headers
    assert answer.headers["content-security-policy"] == CONTENT_SECURITY_POLICY


def test_the_health_check_keeps_the_page_headers_under_a_prefix(app: FastAPI) -> None:
    answer = _send(app, "/player/healthz", "/player")
    assert answer.status_code == 200
    assert "cache-control" not in answer.headers
    assert answer.headers["content-security-policy"] == CONTENT_SECURITY_POLICY
