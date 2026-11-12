"""The application factory. Creating the app opens no connection and reads no secret by itself:
the executor's pool is opened when the server starts the app and closed when it stops it."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from player_backend.db.executor import open_pool
from player_backend.health import router as health_router
from player_backend.http_errors import error_response, install_error_handlers
from player_backend.logging_setup import configure_logging
from player_backend.mail import Mailer
from player_backend.no_mailer import NoMailer
from player_backend.request_policy import response_headers
from player_backend.settings import Settings
from player_backend.site import router as site_router
from player_backend.site.state import SiteState

_access_log = logging.getLogger("player_backend.access")
_log = logging.getLogger("player_backend.app")


def create_app(settings: Settings, mailer: Mailer | None = None) -> FastAPI:
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        pool = open_pool(settings.database_url)
        app.state.site = SiteState(settings=settings, pool=pool, mailer=mailer or NoMailer())
        try:
            yield
        finally:
            pool.close()

    app = FastAPI(
        title="Class player backend",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    install_error_handlers(app)
    app.include_router(health_router)
    app.include_router(site_router)

    @app.middleware("http")
    async def access_log(  # pyright: ignore[reportUnusedFunction]
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            # Answered here so that this response has the headers too. The log line holds the
            # exception's type only (logging_setup.py).
            _log.exception("unhandled error")
            response = error_response(500, "internal_error")
        # ADR 0002, section 5: the page headers on every response, no-store on the site's API.
        response.headers.update(response_headers(request.url.path))
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
