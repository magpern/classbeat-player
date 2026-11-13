"""Guard: a route reads its body before it opens a transaction (ADR 0002, section 10; #101
review, finding 1).

A body read inside a credential's transaction would hold a pool connection for as long as a
slow client takes to upload it, and a body refused there (413) would be refused inside the
transaction. So on every route, each dependency that reads the body (`request_body`,
`publication_body`) is solved before every dependency that holds a transaction
(`site_session`, `device_token`, `source_token`). A body model is read by FastAPI before any
dependency, and is not allowed beside a credential at all (test_guard_raw_parameters.py).

The order is FastAPI's own: the dependencies in declaration order, each one's own
sub-dependencies first, and a dependency already solved not solved again.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant

from player_backend.app import create_app
from player_backend.player_api.deps import DeviceToken
from player_backend.settings import Settings
from player_backend.site.bodies import RawBody, request_body
from player_backend.site.deps import SiteSession
from player_backend.source_api.publications import PublicationBody, publication_body
from tests.routehelp import http_contexts

BODY_READERS: frozenset[Callable[..., object]] = frozenset({request_body, publication_body})
# Every route that reads its body through a reader: a new one is looked at here first.
READS_BODY = frozenset(
    {
        ("POST", "/api/site/pairing/find"),
        ("POST", "/api/site/pairing/decide"),
        ("POST", "/api/site/source-links/check"),
        ("POST", "/api/site/source-links/approve"),
        ("POST", "/api/site/account/delete"),
        ("POST", "/api/site/passkeys"),
        ("PATCH", "/api/site/passkeys/{passkey_id}"),
        ("POST", "/api/source/publications"),
        # ADR 0002, section 8: becoming a controller, by sign-in and by control code.
        ("POST", "/api/live/controller"),
        ("POST", "/api/live/control"),
    }
)


def _holds_transaction(call: Callable[..., object]) -> bool:
    return inspect.isgeneratorfunction(call) or inspect.isasyncgenfunction(call)


def solve_order(dependant: Dependant) -> list[Callable[..., object]]:
    """The dependencies' calls in the order FastAPI solves them."""
    order: list[Callable[..., object]] = []

    def walk(node: Dependant) -> None:
        for sub in node.dependencies:
            walk(sub)
            assert sub.call is not None
            if sub.call not in order:
                order.append(sub.call)

    walk(dependant)
    return order


def late_bodies(app: FastAPI) -> dict[tuple[str, str], list[str]]:
    """(method, path) → the body readers solved after a dependency that holds a transaction."""
    found: dict[tuple[str, str], list[str]] = {}
    for context in http_contexts(app):
        assert context.path is not None and context.methods
        order = solve_order(context.dependant)
        first = next((n for n, call in enumerate(order) if _holds_transaction(call)), len(order))
        late = [call.__name__ for call in order[first:] if call in BODY_READERS]
        if late:
            for method in context.methods:
                found[(method, context.path)] = late
    return found


def _app() -> FastAPI:
    # A placeholder URL: making the app opens no connection.
    settings = Settings(
        database_url="postgresql://player_app:placeholder@127.0.0.1:1/none",
        site_origin="https://player.test",
    )
    return create_app(settings)


def test_every_route_reads_its_body_before_its_transaction() -> None:
    assert late_bodies(_app()) == {}


def test_the_routes_that_read_a_body_equal_the_list() -> None:
    seen: set[tuple[str, str]] = set()
    for context in http_contexts(_app()):
        assert context.path is not None and context.methods
        if any(call in BODY_READERS for call in solve_order(context.dependant)):
            seen.update((method, context.path) for method in context.methods)
    assert seen == READS_BODY


def test_a_body_read_after_a_credential_is_caught() -> None:
    """The guard itself: a route that declares its body after its credential fails it."""
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    @app.post("/late-session")
    def late_session(context: SiteSession, raw: RawBody) -> None:  # pyright: ignore[reportUnusedFunction]
        return None

    @app.post("/late-device")
    def late_device(context: DeviceToken, raw: PublicationBody) -> None:  # pyright: ignore[reportUnusedFunction]
        return None

    @app.post("/early")
    def early(raw: RawBody, context: SiteSession) -> None:  # pyright: ignore[reportUnusedFunction]
        return None

    assert late_bodies(app) == {
        ("POST", "/late-session"): ["request_body"],
        ("POST", "/late-device"): ["publication_body"],
    }
