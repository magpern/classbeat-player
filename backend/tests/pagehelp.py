"""A request to the app as a server hands it over, for the built-page tests (no database)."""

from __future__ import annotations

import asyncio
from urllib.parse import unquote

import httpx
from fastapi import FastAPI
from starlette.types import Message, Scope


def send(app: FastAPI, method: str, raw_path: str, root_path: str = "") -> httpx.Response:
    """The path decoded, never normalised, so `..`, `.` and escapes reach the app as they were
    sent (an HTTP client would tidy them). The path holds the prefix, as servers hand it over."""
    messages: list[Message] = []
    prefix = root_path.rstrip("/")

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def deliver(message: Message) -> None:
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
    asyncio.run(app(scope, receive, deliver))
    start = next(m for m in messages if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    headers = [(k.decode(), v.decode()) for k, v in start["headers"]]
    return httpx.Response(start["status"], headers=headers, content=body)
