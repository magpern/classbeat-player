"""Test helper: how the live routing table is judged against the codes each route sends
(for tests/test_live_route_errors.py and tests/test_live_route_table.py; #234, #240).

- `body_too_large` (413, the body cap, answered before any route is matched) is listed for
  every live route and is in `error.schema.json`'s enum.
- Every other code a route lists is a code it sends, and every code it sends is listed.
  `invalid_request` (422) is sent only by a route that takes a parameter or a body, or reads
  one itself; a route that takes none never lists it. There is no allowance.
"""

from __future__ import annotations

from collections.abc import Mapping

from fastapi.dependencies.models import Dependant

BODY_CAP = "body_too_large"


def takes_input(dependant: Dependant) -> bool:
    """True if FastAPI validates anything for the route (so its 422 handler can answer)."""
    own = (
        dependant.query_params
        or dependant.header_params
        or dependant.path_params
        or dependant.cookie_params
        or dependant.body_params
    )
    return bool(own) or any(takes_input(sub) for sub in dependant.dependencies)


def route_problems(name: str, listed: set[str], answered: set[str]) -> list[str]:
    """Why a route's entry is not what it answers plus the body cap, or nothing."""
    if listed == answered | {BODY_CAP}:
        return []
    return [f"{name}: listed {sorted(listed)}, answers {sorted(answered | {BODY_CAP})}"]


def table_problems(enum: set[str]) -> list[str]:
    """The body cap missing from the error enum."""
    return [] if BODY_CAP in enum else [f"{BODY_CAP} not in the error enum"]


def problems(
    table: Mapping[str, set[str]], answered: Mapping[str, set[str]], enum: set[str]
) -> list[str]:
    found = table_problems(enum)
    for name, listed in sorted(table.items()):
        found += route_problems(name, listed, answered[name])
    return found
