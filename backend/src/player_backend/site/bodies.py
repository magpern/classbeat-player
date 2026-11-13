"""The body of a signed-in request, read as bytes and parsed by the route (ADR 0002, s. 10).

A body model the framework validated would be refused inside the session's transaction and
roll back the session's "last used" (param_policy.py). So a signed-in route takes `RawBody`,
declared before its session so the body is read before the transaction opens, and parses it
with `parsed`, which answers `422 invalid_request` from inside the route.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from pydantic import BaseModel

from player_backend.http_errors import ApiError
from player_backend.param_policy import json_body_of


@dataclass(frozen=True)
class Body:
    content_type: str | None
    raw: bytes


async def request_body(request: Request) -> Body:
    """The body as sent, read whole, as the framework would have read it."""
    return Body(request.headers.get("content-type"), await request.body())


RawBody = Annotated[Body, Depends(request_body)]


def parsed[M: BaseModel](model: type[M], body: Body) -> M:
    found = json_body_of(model, body.content_type, body.raw)
    if found is None:
        raise ApiError(422, "invalid_request")
    return found
