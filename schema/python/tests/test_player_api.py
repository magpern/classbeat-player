"""The player API's answers (schema/player-api/v1): every example gets its verdict from the
JSON Schema, and every valid one round-trips through the generated Pydantic model."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012
from vectors import CLASS_SCHEMA, V1, files, load

API = V1.parent.parent / "player-api" / "v1"
EXAMPLES = API / "examples"
NAMES = ("changes", "class", "cursor", "error")

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "generated" / "python"))

import player_api_changes
import player_api_class
import player_api_cursor
import player_api_error

MODELS: dict[str, Any] = {
    "changes": player_api_changes.ChangesAnswer,
    "class": player_api_class.HeldClassAnswer,
    "cursor": player_api_cursor.CursorAnswer,
    "error": player_api_error.ErrorBody,
}


def validator(name: str) -> Draft202012Validator:
    registry: Registry[Any] = Registry().with_resource(
        CLASS_SCHEMA["$id"], Resource(CLASS_SCHEMA, DRAFT202012)
    )
    return Draft202012Validator(load(API / f"{name}.schema.json"), registry=registry)


def cases(kind: str) -> list[Any]:
    return [
        pytest.param(name, path, id=f"{name}/{path.name}")
        for name in NAMES
        for path in files(EXAMPLES / name / kind)
    ]


def test_every_schema_has_a_valid_and_an_invalid_example() -> None:
    for name in NAMES:
        assert files(EXAMPLES / name / "valid"), name
        assert files(EXAMPLES / name / "invalid"), name


@pytest.mark.parametrize(("name", "path"), cases("valid"))
def test_valid_example_passes(name: str, path: Path) -> None:
    assert list(validator(name).iter_errors(load(path))) == []


@pytest.mark.parametrize(("name", "path"), cases("invalid"))
def test_invalid_example_is_refused(name: str, path: Path) -> None:
    assert list(validator(name).iter_errors(load(path))) != []


@pytest.mark.parametrize(("name", "path"), cases("valid"))
def test_valid_example_round_trips_through_the_generated_model(name: str, path: Path) -> None:
    doc = load(path)
    model = MODELS[name].model_validate(doc)
    # Unset fields are dropped, an explicit null (a removal's hash) stays.
    assert model.model_dump(mode="json", by_alias=True, exclude_unset=True) == doc


def test_generated_model_refuses_an_unknown_field() -> None:
    with pytest.raises(ValidationError):
        player_api_cursor.CursorAnswer.model_validate({"cursor": 1, "extra": 2})
