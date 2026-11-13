"""Guard: a route that holds a transaction takes no parameter the framework parses (ADR 0002,
section 10: a request a route refuses keeps what its credential check wrote).

A dependency with `yield` holds the request's transaction across the route's function: the
credentials' `site_session`, `device_token` and `source_token`. A parameter the framework
parses (an `int`, a `UUID`, a length limit, a body model) is refused inside that transaction,
and the refusal rolls back the count of the token's requests and "last used". So every such
route takes its path and query parameters as plain text and its body through a dependency that
reads bytes, and the route parses them itself (param_policy.py, sync_policy.py).

The raw parameters are listed, so a new one fails here until someone has looked at it.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable

from fastapi.dependencies.models import Dependant
from fastapi.routing import iter_route_contexts

from player_backend.app import create_app
from player_backend.player_api.deps import device_token
from player_backend.settings import Settings
from player_backend.site.deps import site_session
from player_backend.source_api.deps import source_token
from tests.guards.test_guard_cookie_routes import (
    DEVICE_TOKEN_ROUTES,
    SESSION_COOKIE_ROUTES,
    SOURCE_TOKEN_ROUTES,
)

# (method, path) → the raw parameters of each route that holds a transaction and has any.
RAW_PARAMETERS = {
    ("DELETE", "/api/site/sessions/{session_id}"): {"session_id"},
    ("DELETE", "/api/site/devices/{device_id}"): {"device_id"},
    ("DELETE", "/api/site/source-links/{link_id}"): {"link_id"},
    ("GET", "/api/player/changes"): {"after", "limit"},
    ("GET", "/api/player/classes/{class_id}"): {"class_id"},
    ("GET", "/api/source/classes/{source_class_id}"): {"source_class_id"},
}
CREDENTIALS = (site_session, device_token, source_token)


def _calls(dependant: Dependant, found: set[Callable[..., object]]) -> None:
    for sub in dependant.dependencies:
        assert sub.call is not None
        found.add(sub.call)
        _calls(sub, found)


def _all(dependant: Dependant) -> list[Dependant]:
    """The route's own parameters and those of every dependency it resolves."""
    found = [dependant]
    for sub in dependant.dependencies:
        found.extend(_all(sub))
    return found


def _holds_transaction(call: Callable[..., object]) -> bool:
    return inspect.isgeneratorfunction(call) or inspect.isasyncgenfunction(call)


def _routes() -> list[tuple[str, str, Dependant, set[Callable[..., object]]]]:
    # A placeholder URL: making the app opens no connection.
    settings = Settings(
        database_url="postgresql://player_app:placeholder@127.0.0.1:1/none",
        site_origin="https://player.test",
    )
    found: list[tuple[str, str, Dependant, set[Callable[..., object]]]] = []
    for context in iter_route_contexts(create_app(settings).routes):
        assert context.path is not None and context.methods
        calls: set[Callable[..., object]] = set()
        _calls(context.dependant, calls)
        for method in sorted(context.methods):
            found.append((method, context.path, context.dependant, calls))
    return found


def test_each_credential_is_a_dependency_that_holds_a_transaction() -> None:
    # Otherwise the guard below would see no route at all.
    for credential in CREDENTIALS:
        assert _holds_transaction(credential), credential.__name__


def test_a_route_that_holds_a_transaction_takes_only_raw_text() -> None:
    seen: dict[tuple[str, str], set[str]] = {}
    credentialed: set[tuple[str, str]] = set()
    for method, path, dependant, calls in _routes():
        if not any(_holds_transaction(call) for call in calls):
            continue
        credentialed.add((method, path))
        names: set[str] = set()
        for each in _all(dependant):
            assert not each.body_params, (method, path, [f.name for f in each.body_params])
        fields = [
            field
            for each in _all(dependant)
            for field in (
                *each.path_params,
                *each.query_params,
                *each.header_params,
                *each.cookie_params,
            )
        ]
        for field in fields:
            info = field.field_info
            assert info.annotation in (str, str | None), (method, path, field.name)
            # No length limit, pattern or other check of the framework's own.
            assert not info.metadata, (method, path, field.name, info.metadata)
            assert field.alias == field.name, (method, path, field.name)
            names.add(field.name)
        if names:
            seen[(method, path)] = names
    assert seen == RAW_PARAMETERS
    # The routes seen are every route that takes a credential.
    assert credentialed == SESSION_COOKIE_ROUTES | DEVICE_TOKEN_ROUTES | SOURCE_TOKEN_ROUTES
