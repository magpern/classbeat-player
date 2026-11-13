"""The cap on a request's body (body_policy.py): `413 body_too_large`.

`BodyCap` is an ASGI middleware, inside the access log and outside every route:

- a `Content-Length` over the cap is answered at once, before the app sees the request;
- otherwise the body's bytes are counted as the route reads them, and the read that goes over
  the cap raises `BodyTooLarge`. The rest is never read.

A route reads its body before its credential (tests/guards/test_guard_body_order.py), so either
way the answer comes before any credential is looked at or any transaction is opened.
`BodyTooLarge` is an `HTTPException` so that FastAPI passes it on as it is when it reads a body
model; any other error there it would turn into a 400.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from player_backend.body_policy import body_cap, declared_over
from player_backend.http_errors import error_response

CODE = "body_too_large"


class BodyTooLarge(HTTPException):
    def __init__(self) -> None:
        super().__init__(413, CODE)


class BodyCap:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        cap = body_cap(str(scope["path"])) if scope["type"] == "http" else None
        if cap is None:
            await self.app(scope, receive, send)
            return
        if declared_over(Headers(scope=scope).get("content-length"), cap):
            await error_response(413, CODE)(scope, receive, send)
            return
        read = 0

        async def capped() -> Message:
            nonlocal read
            message = await receive()
            if message["type"] == "http.request":
                read += len(message.get("body", b""))
                if read > cap:
                    raise BodyTooLarge
            return message

        await self.app(scope, capped, send)


def install_body_cap(app: FastAPI) -> None:
    """Add the middleware and the answer to `BodyTooLarge`. Called before the access log's
    middleware is added, so that the access log stays outside and logs and heads every 413."""

    async def too_large(request: Request, error: Exception) -> JSONResponse:
        return error_response(413, CODE)

    app.add_exception_handler(BodyTooLarge, too_large)
    app.add_middleware(BodyCap)
