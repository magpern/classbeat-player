"""Each live HTTP route answers exactly the error codes its entry in
`schema/live/v1/routing.json` lists (ADR 0005, section 4; #223 N1, #227). No database.

The codes a route can answer are read from its code (tests/errorread.py): every `ApiError` its
function and each of its dependencies raise, following the functions of this package they call
by name or through a module, as FastAPI's dependency tree for the route gives them. The reading
fails closed: any error form it cannot read (an `ApiError` through a module, `error_response`,
a response with a status, `HTTPException`, a code it cannot resolve, an `ApiError` subclass that
sets its code another way) fails the test. What it does not follow is checked apart: no live or
database module but the routes, and no class the read code names, names an error form; and in
each module it went into, every definition naming one was read or is listed as on no live route.
Added to the codes read:

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

import inspect
import json
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.dependencies.models import Dependant
from fastapi.responses import JSONResponse
from fastapi.routing import RouteContext
from starlette.testclient import TestClient

from player_backend import app as app_module
from player_backend import http_errors
from player_backend.app import create_app
from player_backend.db import live as db_live
from player_backend.db.executor import Pool
from player_backend.http_errors import ApiError, error_response
from player_backend.live import control_routes
from player_backend.settings import Settings
from player_backend.site.deps import NotSignedIn
from tests.errorread import FORM_WORDS, Reader, Unreadable, naming_forms
from tests.livehelp import SCHEMA, SITE
from tests.routehelp import http_contexts

ROUTING = json.loads((SCHEMA / "routing.json").read_text(encoding="utf-8"))
TABLE: dict[str, set[str]] = {r["route"]: set(r["errors"]) for r in ROUTING["http"]}
APP_WIDE = {"invalid_request", "internal_error"}
BEFORE_ROUTING = {"body_too_large"}
# Definitions that name an error form in a module the reading goes into, and are on no live
# route (`_OneRefusal` is the sign-in route's class, applied in `_answered`).
NOT_ON_A_LIVE_ROUTE: dict[str, set[str]] = {
    "player_backend.live.control_routes": {"_OneRefusal"},
    "player_backend.site.deps": {"recent_sign_in"},
    "player_backend.player_api.deps": {"app_only"},
    "player_backend.site.bodies": {"parsed"},
    # These put a cookie on a response; none answers an error.
    "player_backend.site.cookies": {
        "_put",
        "put_session_cookie",
        "clear_session_cookie",
        "put_login_cookie",
    },
}
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


def _read(route: RouteContext) -> Reader:
    reader = Reader()
    for fn in _calls(route.dependant):
        reader.function(fn)
    return reader


def _answered(route: RouteContext) -> set[str]:
    reader = _read(route)
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


def test_no_live_or_database_module_but_the_routes_names_an_error_form() -> None:
    """The routes' calls through an object (the service, the registry, the database) are not
    read: none of those modules names an error form."""
    named = {
        str(path.relative_to(SOURCE))
        for folder in ("live", "db")
        for path in (SOURCE / folder).rglob("*.py")
        if FORM_WORDS.search(path.read_text(encoding="utf-8"))
    }
    assert named == {"live/routes.py", "live/control_routes.py"}


def test_every_definition_naming_an_error_form_in_a_read_module_is_read_or_listed() -> None:
    """In each module the reading went into (the routes', site/deps.py, player_api/deps.py and
    the rest), a top-level definition that names an error form is one the reading read, or one
    listed in `NOT_ON_A_LIVE_ROUTE`; and no class the read code names (whose methods it does not
    read) names one."""
    readers = [_read(route) for route in _live_routes(_app()).values()]
    read = {fn for r in readers for fn in r.read}
    read_names = {(f.__module__, f.__qualname__.split(".")[0]) for f in read}
    modules = {f.__module__ for f in read}
    for name in sorted(modules):
        module = sys.modules[name]
        listed = NOT_ON_A_LIVE_ROUTE.get(name, set())
        found = {(name, d) for d in naming_forms(module)}
        assert found == {(name, d) for d in listed} | (found & read_names), name
        assert not {(name, d) for d in listed} & read_names, name
    for cls in {c for r in readers for c in r.classes}:
        assert not FORM_WORDS.search(inspect.getsource(cls)), cls.__qualname__


# -- what the reading refuses to read ---------------------------------------------------------


class _SetsItsCode(ApiError):
    def __init__(self) -> None:
        super().__init__(410, "gone")
        self.code = "other"


class _CodeAnotherWay(ApiError):
    def __init__(self) -> None:
        ApiError.__init__(self, 410, "gone")


class _Deeper(NotSignedIn):
    pass


def _through_a_module() -> None:
    raise http_errors.ApiError(410, "gone")


def _returned() -> JSONResponse:
    return error_response(410, "gone")


def _with_a_status() -> JSONResponse:
    return JSONResponse({"error": "gone"}, status_code=410)


def _http_exception() -> None:
    raise HTTPException(410)


def _a_code_by_name() -> None:
    code = "gone"
    raise ApiError(410, code)


def _a_status_by_name() -> None:
    status = 410
    raise ApiError(status, "gone")


def _sets_its_code() -> None:
    raise _SetsItsCode


def _code_another_way() -> None:
    raise _CodeAnotherWay()


def _deeper() -> None:
    raise _Deeper


def _passed_on(make: Callable[..., Exception] = ApiError) -> None:
    raise make(410, "gone")


@pytest.mark.parametrize(
    "fn",
    [
        _through_a_module,
        _returned,
        _with_a_status,
        _http_exception,
        _a_code_by_name,
        _a_status_by_name,
        _sets_its_code,
        _code_another_way,
        _deeper,
        _passed_on,
    ],
)
def test_an_error_form_the_reading_cannot_read_fails_it(fn: Callable[[], object]) -> None:
    with pytest.raises(Unreadable):
        Reader().function(fn)


def _readable() -> JSONResponse:
    if False:
        raise NotSignedIn
    try:
        raise ApiError(409, "gone")
    except ApiError:
        pass
    return JSONResponse({"ok": True})


def test_the_forms_it_reads_are_read() -> None:
    reader = Reader()
    reader.function(_readable)
    assert reader.raised == {(401, "not_signed_in"), (409, "gone")}


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
