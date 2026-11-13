"""The rules `routetable.py` judges the live routing table by (#234, #237, #240).

The tables are fixed copies in this file: none is read from `routing.json`, so the contract can
change without this file moving (the real table is checked against the real routes in
test_live_route_errors.py). Every route lists `body_too_large` and the error enum holds it; every
other listed code is a code the route sends and every code it sends is listed, with no
allowance. Each case names the mutation that fails it. No database.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from tests.routehelp import http_contexts
from tests.routetable import BODY_CAP, problems, takes_input

SESSIONS = "POST /api/live/sessions"
CONTROLLER = "POST /api/live/controller"
CONTROL = "POST /api/live/control"
# Fixed copies of the two shapes, not read from routing.json (that table is checked against the
# real routes in test_live_route_errors.py); `routetable.py` is tested against these alone.
ANSWERED: dict[str, set[str]] = {
    SESSIONS: {
        "invalid_token",
        "token_unknown",
        "token_expired",
        "token_revoked",
        "sessions_full",
        "too_many_requests",
        "internal_error",
    },
    CONTROLLER: {"invalid_request", "cannot_control", "internal_error"},
    CONTROL: {
        "invalid_request",
        "invalid_code",
        "controllers_full",
        "too_many_requests",
        "internal_error",
    },
}
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
    BODY_CAP,
}


def _table() -> dict[str, set[str]]:
    return {name: codes | {BODY_CAP} for name, codes in ANSWERED.items()}


def test_the_table_that_lists_what_is_sent_and_the_body_cap_passes() -> None:
    assert problems(_table(), ANSWERED, ERROR_ENUM) == []


def test_the_body_cap_missing_from_the_enum_fails() -> None:
    """Mutation: `body_too_large` left out of error.schema.json's enum."""
    found = problems(_table(), ANSWERED, ERROR_ENUM - {BODY_CAP})
    assert found == [f"{BODY_CAP} not in the error enum"]


@pytest.mark.parametrize("name", sorted(ANSWERED))
def test_the_body_cap_missing_from_any_one_route_fails(name: str) -> None:
    """Mutation: `body_too_large` dropped from that route's entry."""
    table = _table()
    table[name].discard(BODY_CAP)
    found = problems(table, ANSWERED, ERROR_ENUM)
    assert len(found) == 1 and name in found[0]


def test_a_table_without_the_body_cap_anywhere_fails() -> None:
    """Mutation: the old shape, no route lists `body_too_large` (no "none" branch)."""
    assert len(problems(ANSWERED, ANSWERED, ERROR_ENUM)) == len(ANSWERED)


def test_invalid_request_listed_for_a_route_that_takes_no_input_fails() -> None:
    """Mutation: `invalid_request` re-added to `POST /api/live/sessions` (sends none)."""
    table = _table()
    table[SESSIONS].add("invalid_request")
    found = problems(table, ANSWERED, ERROR_ENUM)
    assert len(found) == 1 and SESSIONS in found[0]


def test_another_code_listed_but_unsent_fails() -> None:
    """Mutation: `sessions_full` added to the controller's entry."""
    table = _table()
    table[CONTROLLER].add("sessions_full")
    assert len(problems(table, ANSWERED, ERROR_ENUM)) == 1


def test_a_code_sent_but_not_listed_fails() -> None:
    """Mutation: `internal_error` dropped from an entry."""
    table = _table()
    table[CONTROL].discard("internal_error")
    assert len(problems(table, ANSWERED, ERROR_ENUM)) == 1


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
