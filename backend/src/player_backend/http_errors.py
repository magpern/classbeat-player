"""The API's error answers: a status and a fixed code, never what the client sent.

A validation error is answered without the offending input: on a token endpoint that input is
a token (ADR 0002, principle 4).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, headers: Mapping[str, str] | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.headers = dict(headers or {})


def error_response(
    status: int, code: str, headers: Mapping[str, str] | None = None
) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status, headers=dict(headers or {}))


def install_error_handlers(app: FastAPI) -> None:
    async def api_error(request: Request, error: Exception) -> JSONResponse:
        known = cast(ApiError, error)
        return error_response(known.status, known.code, known.headers)

    async def invalid_request(request: Request, error: Exception) -> JSONResponse:
        return error_response(422, "invalid_request")

    app.add_exception_handler(ApiError, api_error)
    app.add_exception_handler(RequestValidationError, invalid_request)
