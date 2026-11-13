"""Test helper: how the live routing table is judged against the codes each route sends
(for tests/test_live_route_errors.py and tests/test_live_route_table.py; #234).

Two things the contract may list differently over time, and both shapes pass:

- `body_too_large` (413, the body cap, answered before any route is matched): listed for every
  live route (and then in `error.schema.json`'s enum) or for none of them. Never for some only.
- `invalid_request` (422): sent by a route only if it takes a parameter or a body, or reads
  one itself. A route that takes none can never send it; `UNSENT_BUT_LISTED` names the one
  route whose entry still lists it while the table says so. Nothing else is let through.
"""

from __future__ import annotations

from collections.abc import Mapping

from fastapi.dependencies.models import Dependant

BODY_CAP = "body_too_large"
# Listed in routing.json today, never sent: the route takes no body and no parameter.
UNSENT_BUT_LISTED: Mapping[str, frozenset[str]] = {
    "POST /api/live/sessions": frozenset({"invalid_request"}),
}


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
    """Why a route's entry is not what it answers (the body cap aside), or nothing."""
    entry = listed - {BODY_CAP}
    unsent = (entry & UNSENT_BUT_LISTED.get(name, frozenset())) - answered
    if entry - unsent == answered:
        return []
    return [f"{name}: listed {sorted(entry - unsent)}, answers {sorted(answered)}"]


def table_problems(table: Mapping[str, set[str]], enum: set[str]) -> list[str]:
    """The body cap listed for some live routes only, or listed but not in the error enum."""
    listing = {name for name, listed in table.items() if BODY_CAP in listed}
    problems: list[str] = []
    if listing and listing != set(table):
        problems.append(f"{BODY_CAP} listed for only {sorted(listing)}")
    if listing and BODY_CAP not in enum:
        problems.append(f"{BODY_CAP} listed but not in the error enum")
    return problems


def problems(
    table: Mapping[str, set[str]], answered: Mapping[str, set[str]], enum: set[str]
) -> list[str]:
    found = table_problems(table, enum)
    for name, listed in sorted(table.items()):
        found += route_problems(name, listed, answered[name])
    return found
