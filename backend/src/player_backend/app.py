"""The application factory. Creating the app opens no connection and reads no secret by itself."""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from player_backend.health import router as health_router
from player_backend.logging_setup import configure_logging
from player_backend.settings import Settings

_access_log = logging.getLogger("player_backend.access")


def create_app(settings: Settings) -> FastAPI:
    configure_logging(settings.log_level)
    app = FastAPI(
        title="Class player backend",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.include_router(health_router)

    @app.middleware("http")
    async def access_log(  # pyright: ignore[reportUnusedFunction]
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.monotonic()
        response = await call_next(request)
        # Method, path and status only: never the query string, a header or a body.
        _access_log.info(
            "request",
            extra={
                "fields": {
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.monotonic() - started) * 1000, 1),
                }
            },
        )
        return response

    return app


def app_from_env() -> FastAPI:
    """Entry point for the server: `uvicorn --factory player_backend.app:app_from_env`."""
    return create_app(Settings.from_env())
