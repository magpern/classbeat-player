"""The live contract's schemas, read from the contract lane's files (schema/live/v1).

The schemas are the one source: every message the live process takes or sends is checked with
its JSON Schema, never with the generated models (schema/live/README.md: the models do not hold
the conditional rules). Read once per process; a missing or unreadable file fails loudly.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any, Final, cast

from jsonschema import Draft202012Validator

from player_backend.live_route_policy import Route, parse_routes

# backend/src/player_backend/live/ -> the repository's root.
SCHEMA_DIR: Final = Path(__file__).resolve().parents[4] / "schema" / "live" / "v1"


@cache
def _validator(name: str) -> Draft202012Validator:
    if "/" in name or "\\" in name or not name.endswith(".schema.json"):
        raise ValueError("not a live schema name: " + name)
    loaded: Any = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError("a live schema must be a JSON object: " + name)
    schema = cast(dict[str, Any], loaded)
    Draft202012Validator.check_schema(schema)  # pyright: ignore[reportUnknownMemberType]
    return Draft202012Validator(schema)


def valid(name: str, value: object) -> bool:
    """Whether `value` passes the live schema in file `name`."""
    return bool(_validator(name).is_valid(cast(Any, value)))  # pyright: ignore[reportUnknownMemberType]


@cache
def routes() -> tuple[Route, ...]:
    """The routing allowlist, as routing.json gives it."""
    return parse_routes(json.loads((SCHEMA_DIR / "routing.json").read_text(encoding="utf-8")))
