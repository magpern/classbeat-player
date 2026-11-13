"""The judgement of the live routing table, on today's table and on the planned one (#234, #237).
The tables below are fixed copies in this file: none is read from `routing.json`, so the
contract can change without this file moving.

Today `routing.json` lists no 413 and lists `invalid_request` for `POST /api/live/sessions`
(which takes no body); the contract will list `body_too_large` for every live route and drop
that `invalid_request`. Both shapes pass; each case below names the mutation that fails it.
No database.
"""

from __future__ import annotations

import copy
from typing import Any

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from tests.routehelp import http_contexts
from tests.routetable import BODY_CAP, problems, takes_input

SESSIONS = "POST /api/live/sessions"
CONTROLLER = "POST /api/live/controller"
CONTROL = "POST /api/live/control"
# Fixed copies of the two shapes, not read from routing.json (that table is checked against the
# real routes in test_live_route_errors.py); `routetable.py` is tested against these alone.
_SESSIONS_SENDS = {
    "invalid_token",
    "token_unknown",
    "token_expired",
    "token_revoked",
    "sessions_full",
    "too_many_requests",
    "internal_error",
}
ANSWERED: dict[str, set[str]] = {
    SESSIONS: _SESSIONS_SENDS,
    CONTROLLER: {"invalid_request", "cannot_control", "internal_error"},
    CONTROL: {
        "invalid_request",
        "invalid_code",
        "controllers_full",
        "too_many_requests",
        "internal_error",
    },
}
TODAY: dict[str, set[str]] = {n: set(c) for n, c in ANSWERED.items()}
TODAY[SESSIONS].add("invalid_request")  # listed, never sent: the route takes no body
# The error enum of today's schema (no `body_too_large`).
ERROR_ENUM = {
    "invalid_request",
    "invalid_token",
    "token_unknown",
    "token_expired",
    "token_revoked",
    "sessions_full",
    "cannot_control",
    "invalid_code",
    "controllers_full",
    "too_many_requests",
    "internal_error",
}


def _planned() -> dict[str, set[str]]:
    table = copy.deepcopy(ANSWERED)
    for entry in table.values():
        entry.add(BODY_CAP)
    return table


def _check(table: dict[str, set[str]], enum: set[str] | None = None) -> list[str]:
    return problems(table, ANSWERED, ERROR_ENUM | {BODY_CAP} if enum is None else enum)


def _check_with(table: dict[str, set[str]], answered: dict[str, set[str]]) -> list[str]:
    return problems(table, answered, ERROR_ENUM | {BODY_CAP})


def test_today_passes_with_its_one_named_unsent_code() -> None:
    assert _check(TODAY, ERROR_ENUM) == []


def test_the_planned_table_passes() -> None:
    assert _check(_planned()) == []


def test_the_planned_table_without_the_enum_value_fails() -> None:
    """Mutation: `body_too_large` left out of error.schema.json's enum."""
    assert _check(_planned(), ERROR_ENUM) == [f"{BODY_CAP} listed but not in the error enum"]


def test_the_body_cap_for_some_routes_only_fails() -> None:
    """Mutation: `body_too_large` dropped from one live route's entry."""
    table = _planned()
    table["POST /api/live/control"].discard(BODY_CAP)
    assert len(_check(table)) == 1 and "only" in _check(table)[0]


def test_the_unsent_code_is_let_through_for_that_route_only() -> None:
    """Mutation: the same listed-but-unsent code on another route (`controller` sends it, so
    take it away from what that route sends)."""
    answered = {n: set(c) for n, c in ANSWERED.items()}
    answered["POST /api/live/controller"].discard("invalid_request")
    found = problems(TODAY, answered, ERROR_ENUM)
    assert len(found) == 1 and "controller" in found[0]


def test_another_code_listed_but_unsent_fails() -> None:
    """Mutation: `sessions_full` added to the controller's entry; nothing allows it."""
    table = _planned()
    table["POST /api/live/controller"].add("sessions_full")
    assert len(_check(table)) == 1


def test_a_code_sent_but_not_listed_fails() -> None:
    """Mutation: `internal_error` dropped from an entry (also with the planned shape)."""
    for table in (copy.deepcopy(TODAY), _planned()):
        table["POST /api/live/control"].discard("internal_error")
        assert len(_check(table)) == 1


def test_the_allowance_covers_only_a_code_that_is_not_sent() -> None:
    """Mutation: the route takes a body after all; the entry must then list the code, and the
    planned table (which drops it) fails."""
    answered = {n: set(c) for n, c in ANSWERED.items()}
    answered[SESSIONS].add("invalid_request")
    assert problems(TODAY, answered, ERROR_ENUM) == []
    assert len(_check_with(_planned(), answered)) == 1


def _tiny(**params: Any) -> bool:
    app = FastAPI()
    if params:

        @app.post("/x")
        def with_query(q: str = Query()) -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
            return JSONResponse({"q": q})
    else:

        @app.post("/x")
        def bare() -> JSONResponse:  # pyright: ignore[reportUnusedFunction]
            return JSONResponse({})

    (context,) = [c for c in http_contexts(app) if c.path == "/x"]
    return takes_input(context.dependant)


def test_a_route_with_a_parameter_takes_input_and_one_without_does_not() -> None:
    """Mutation: `takes_input` always True (the bare route would then answer 422) or always
    False (the parameter route would then not)."""
    assert _tiny(q=1) is True
    assert _tiny() is False
