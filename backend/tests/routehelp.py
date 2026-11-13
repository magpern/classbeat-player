"""Every route of the app, with the dependencies FastAPI resolves for it (for the guard tests).

Anything that is not an API route (a mount, a plain route, a WebSocket) fails here until
someone has said how the guards see it.

WebSocket routes (ADR 0002, section 8): each is listed in `WEBSOCKETS`, and takes no
dependency, no cookie, no header, no query and no path parameter: its token comes in its first
message (`hello`), never in the address or a cookie. The HTTP guards see only the API routes;
a WebSocket route that is not listed, or takes any of these, fails here.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, APIWebSocketRoute, RouteContext, iter_route_contexts

WEBSOCKETS = frozenset({"/api/live/ws"})


@dataclass(frozen=True)
class RouteInfo:
    method: str
    path: str
    dependencies: frozenset[Callable[..., object]]


def _dependencies(dependant: Dependant, found: set[Callable[..., object]]) -> None:
    for sub in dependant.dependencies:
        assert sub.call is not None
        found.add(sub.call)
        _dependencies(sub, found)


def websocket_paths(app: FastAPI) -> set[str]:
    """The app's WebSocket routes, each checked to take nothing but its socket."""
    found: set[str] = set()
    for context in iter_route_contexts(app.routes):
        if isinstance(context.original_route, APIWebSocketRoute):
            dependant = context.dependant
            assert context.path in WEBSOCKETS, context.path
            assert not dependant.dependencies, context.path
            assert not dependant.cookie_params and not dependant.header_params, context.path
            assert not dependant.query_params and not dependant.path_params, context.path
            assert not dependant.body_params, context.path
            found.add(context.path)
    return found


def http_contexts(app: FastAPI) -> list[RouteContext]:
    """The app's API routes; its WebSocket routes are checked (`websocket_paths`) and left out."""
    websocket_paths(app)
    return [
        context
        for context in iter_route_contexts(app.routes)
        if not isinstance(context.original_route, APIWebSocketRoute)
    ]


def routes_of(app: FastAPI) -> list[RouteInfo]:
    found: list[RouteInfo] = []
    for context in http_contexts(app):
        assert isinstance(context.original_route, APIRoute), context.path
        assert context.path is not None and context.methods
        dependencies: set[Callable[..., object]] = set()
        _dependencies(context.dependant, dependencies)
        for method in sorted(context.methods):
            found.append(RouteInfo(method, context.path, frozenset(dependencies)))
    return found
