"""Each live HTTP route answers exactly the error codes its entry in
`schema/live/v1/routing.json` lists (ADR 0005, section 4; #223 N1, #227). No database.

The codes a route can answer are read from its code: every `ApiError` its function and each of
its dependencies raise, following the module-level functions and `ApiError` classes they call,
as FastAPI's dependency tree for the route gives them. A code the reading cannot resolve fails
the test, so a new kind of raise is never passed over silently. Added to those:

- the sign-in route's class (`_OneRefusal`) answers every 401 and 403 as 403 `cannot_control`
  (checked by requests below too);
- every route of the app may answer 422 `invalid_request` (the validation handler) and 500
  `internal_error` (the access log), both installed on the app as a whole (app.py,
  http_errors.py).

The body cap's 413 `body_too_large` is answered before any route is matched (body_cap.py), for
every route of the app; it is not in the live table, and is listed apart below
(`BEFORE_ROUTING`) and checked to be answered. Requests below check, on fakes, a sample of the
codes as answered.
"""

from __future__ import annotations

import ast
import inspect
import json
import textwrap
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import RouteContext
from starlette.testclient import TestClient

from player_backend import app as app_module
from player_backend.app import create_app
from player_backend.db import live as db_live
from player_backend.db.executor import Pool
from player_backend.http_errors import ApiError
from player_backend.live import control_routes
from player_backend.settings import Settings
from tests.livehelp import SCHEMA, SITE
from tests.routehelp import http_contexts

ROUTING = json.loads((SCHEMA / "routing.json").read_text(encoding="utf-8"))
TABLE: dict[str, set[str]] = {r["route"]: set(r["errors"]) for r in ROUTING["http"]}
APP_WIDE = {"invalid_request", "internal_error"}
BEFORE_ROUTING = {"body_too_large"}
SOURCE = Path(__file__).resolve().parents[1] / "src" / "player_backend"


def _app() -> FastAPI:
    return create_app(Settings(database_url="postgresql://unused", site_origin=SITE))


def _live_routes(app: FastAPI) -> dict[str, RouteContext]:
    found: dict[str, RouteContext] = {}
    for context in http_contexts(app):
        if context.path is not None and context.path.startswith("/api/live/"):
            for method in context.methods or ():
                found[f"{method} {context.path}"] = context
    return found


def _calls(dependant: Dependant) -> Iterator[Callable[..., Any]]:
    if dependant.call is not None:
        yield dependant.call
    for sub in dependant.dependencies:
        yield from _calls(sub)


def _ours(value: object) -> bool:
    return getattr(value, "__module__", "").startswith("player_backend.")


class _Reader:
    """The (status, code) pairs of every `ApiError` a function can raise, as written."""

    def __init__(self) -> None:
        self.seen: set[object] = set()
        self.raised: set[tuple[int, str]] = set()

    def function(self, fn: Callable[..., Any]) -> None:
        fn = inspect.unwrap(fn)
        if fn in self.seen:
            return
        self.seen.add(fn)
        tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
        names: dict[str, Any] = getattr(fn, "__globals__", {})
        for node in ast.walk(tree):
            if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Name):
                self._name(names.get(node.exc.id))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                target = names.get(node.func.id)
                if target is ApiError:
                    self._api_error(node, names)
                else:
                    self._name(target)

    def _name(self, target: object) -> None:
        if inspect.isclass(target) and issubclass(target, ApiError) and target is not ApiError:
            self._subclass(target)
        elif inspect.isfunction(target) and _ours(target):
            self.function(target)

    def _subclass(self, cls: type[ApiError]) -> None:
        tree = ast.parse(textwrap.dedent(inspect.getsource(cls)))
        names = vars(inspect.getmodule(cls))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "__init__"
            ):
                self._api_error(node, names)

    def _api_error(self, call: ast.Call, names: dict[str, Any]) -> None:
        status, code = call.args[0], call.args[1]
        assert isinstance(status, ast.Constant) and isinstance(status.value, int)
        for value in _codes(code, names):
            self.raised.add((status.value, value))


def _codes(node: ast.expr, names: dict[str, Any]) -> set[str]:
    """The codes an expression can be: a string, or a subscript of a module-level dict."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
        table = names.get(node.value.id)
        if isinstance(table, dict):
            values = list(cast(dict[object, object], table).values())
            assert all(isinstance(v, str) for v in values)
            return {cast(str, v) for v in values}
    raise AssertionError(f"a code this test cannot read: {ast.dump(node)}")


def _answered(route: RouteContext) -> set[str]:
    reader = _Reader()
    for fn in _calls(route.dependant):
        reader.function(fn)
    one_refusal = isinstance(route.original_route, control_routes._OneRefusal)  # pyright: ignore[reportPrivateUsage]
    codes = {
        "cannot_control" if one_refusal and status in (401, 403) else code
        for status, code in reader.raised
    }
    return codes | APP_WIDE


def test_the_live_routes_are_the_tables_routes() -> None:
    assert set(_live_routes(_app())) == set(TABLE)


@pytest.mark.parametrize("name", sorted(TABLE))
def test_a_routes_error_codes_are_its_entry_in_routing_json(name: str) -> None:
    assert _answered(_live_routes(_app())[name]) == TABLE[name]
    assert not BEFORE_ROUTING & TABLE[name]


def test_the_live_code_that_raises_api_errors_is_what_the_reading_covers() -> None:
    """The routes' other calls (the service, the registry, the database) go through attributes,
    which the reading does not follow: none of those modules names `ApiError`."""
    named = {
        str(path.relative_to(SOURCE))
        for folder in ("live", "db")
        for path in (SOURCE / folder).rglob("*.py")
        if "ApiError" in path.read_text(encoding="utf-8")
    }
    assert named == {"live/routes.py", "live/control_routes.py"}


# -- the same codes, as answered (fakes) -----------------------------------------------------


class _FakePool:
    def close(self) -> None:
        pass


def _open_pool(_url: str) -> Pool:
    return cast(Pool, _FakePool())


def _record_event(*_args: object) -> str:
    return db_live.RECORDED


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(app_module, "open_pool", _open_pool)
    monkeypatch.setattr(db_live, "record_event", _record_event)
    with TestClient(create_app(Settings("postgresql://unused", SITE), live_recheck=None)) as c:
        yield c


def _post(client: TestClient, path: str, headers: dict[str, str], **sent: Any) -> httpx.Response:
    # Starlette's test client is typed loosely: the answer is an httpx response.
    return cast(httpx.Response, client.post(path, headers=headers, **sent))  # pyright: ignore[reportUnknownMemberType]


JSON = {"content-type": "application/json"}
SAME_SITE = {"origin": SITE, "sec-fetch-site": "same-origin"} | JSON


def _control_body() -> dict[str, str]:
    return {"session": "BCDF-GHJK", "code": "LMNP-QRST"}


@pytest.mark.parametrize(
    ("path", "headers", "body", "status", "code"),
    [
        ("/api/live/sessions", {}, None, 401, "invalid_token"),
        ("/api/live/controller", SAME_SITE, {"session": "x"}, 403, "cannot_control"),
        ("/api/live/controller", JSON | {"origin": "https://x.test"}, None, 403, "cannot_control"),
        ("/api/live/control", JSON, {"session": 1}, 422, "invalid_request"),
        ("/api/live/control", JSON, "control", 403, "invalid_code"),
    ],
)
def test_a_sample_of_the_codes_as_answered(
    client: TestClient,
    path: str,
    headers: dict[str, str],
    body: object,
    status: int,
    code: str,
) -> None:
    sent = _control_body() if body == "control" else body
    answer = _post(client, path, headers, json=sent)
    assert (answer.status_code, answer.json()) == (status, {"error": code})
    assert code in TABLE[f"POST {path}"]


@pytest.mark.parametrize("name", sorted(TABLE))
def test_the_body_cap_answers_before_routing(client: TestClient, name: str) -> None:
    path = name.split(" ", 1)[1]
    answer = _post(client, path, JSON | {"content-length": str(10**6)}, content=b"{}")
    assert (answer.status_code, answer.json()) == (413, {"error": "body_too_large"})
    assert BEFORE_ROUTING == {answer.json()["error"]}
