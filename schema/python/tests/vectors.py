"""Test helper: loads the schema files and the shared vectors (the only file I/O here)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

V1 = Path(__file__).resolve().parents[2] / "class-format" / "v1"
EXAMPLES = V1 / "examples"


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


CLASS_SCHEMA = load(V1 / "class.schema.json")
PUBLICATION_SCHEMA = load(V1 / "publication.schema.json")


def files(directory: Path) -> list[Path]:
    return sorted(p for p in directory.glob("*.json") if p.name != "expected.json")
