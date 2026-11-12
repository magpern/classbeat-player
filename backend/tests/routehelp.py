"""Every route of the app, with the dependencies FastAPI resolves for it (for the guard tests).

Anything that is not an API route (a mount, a plain route, a WebSocket) fails here until
someone has said how the guards see it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts


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


def routes_of(app: FastAPI) -> list[RouteInfo]:
    found: list[RouteInfo] = []
    for context in iter_route_contexts(app.routes):
        assert isinstance(context.original_route, APIRoute), context.path
        assert context.path is not None and context.methods
        dependencies: set[Callable[..., object]] = set()
        _dependencies(context.dependant, dependencies)
        for method in sorted(context.methods):
            found.append(RouteInfo(method, context.path, frozenset(dependencies)))
    return found
