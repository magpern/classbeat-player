"""The class format's schemas, read from the contract lane's files (ADR 0003, section 1).

The schemas are the one source; the backend reads them as they are in `schema/`, once per
process. A missing or unreadable file fails the first publication loudly, never quietly.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any, Final

# backend/src/player_backend/ -> the repository's root.
SCHEMA_DIR: Final = Path(__file__).resolve().parents[3] / "schema" / "class-format" / "v1"


def _read(name: str) -> dict[str, Any]:
    loaded = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError("a class format schema must be a JSON object: " + name)
    return loaded  # pyright: ignore[reportUnknownVariableType]


@cache
def schemas() -> tuple[dict[str, Any], dict[str, Any]]:
    """(the class document's schema, the publication envelope's schema)."""
    return _read("class.schema.json"), _read("publication.schema.json")
