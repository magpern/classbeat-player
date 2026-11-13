"""Test helper for the live contract (schema/live/v1): loads its schemas, its routing allowlist
and its examples (the only file I/O here).

Example files never hold a whole token: a token's 43-character secret is written as the
placeholder `<secret43>` and built here at run time (ADR 0002, section 2: CI scans for leaked
tokens, tests build their tokens at run time)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

LIVE = Path(__file__).resolve().parents[2] / "live"
V1 = LIVE / "v1"
GUARD = LIVE / "guard"
EXAMPLES = V1 / "examples"
PLACEHOLDER = "<secret43>"
SECRET = ("Ab3-_xY9" * 6)[:43]


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8").replace(PLACEHOLDER, SECRET))


def names() -> list[str]:
    """Every live schema, by its file name without `.schema.json`."""
    return sorted(p.name.removesuffix(".schema.json") for p in V1.glob("*.schema.json"))


def schema(name: str) -> dict[str, Any]:
    return load(V1 / f"{name}.schema.json")


def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(schema(name))


def routing() -> dict[str, Any]:
    return load(V1 / "routing.json")


def examples(name: str, kind: str) -> list[Path]:
    return sorted((EXAMPLES / name / kind).glob("*.json"))


def words(file: str) -> set[str]:
    """A guard word list: one lowercase word per line, `#` starts a comment."""
    out: set[str] = set()
    for line in (GUARD / file).read_text(encoding="utf-8").splitlines():
        word = line.split("#", 1)[0].strip()
        if word:
            out.add(word)
    return out
