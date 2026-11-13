"""The site's answers (schema/site-api/v1): every example gets its verdict from the JSON Schema,
every valid one round-trips through the generated Pydantic model, and the /me answer carries
the signed-in account's email and nothing else."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError
from vectors import V1, files, load

API = V1.parent.parent / "site-api" / "v1"
EXAMPLES = API / "examples"
NAMES = ("me",)

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "generated" / "python"))

import site_api_me

MODELS: dict[str, Any] = {"me": site_api_me.MeAnswer}


def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(load(API / f"{name}.schema.json"))


def cases(kind: str) -> list[Any]:
    return [
        pytest.param(name, path, id=f"{name}/{path.name}")
        for name in NAMES
        for path in files(EXAMPLES / name / kind)
    ]


def test_every_schema_has_a_valid_and_an_invalid_example() -> None:
    assert sorted(p.name.removesuffix(".schema.json") for p in API.glob("*.schema.json")) == list(
        NAMES
    )
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
    assert MODELS[name].model_validate(doc).model_dump(mode="json") == doc


@pytest.mark.parametrize(("name", "path"), cases("invalid"))
def test_generated_model_refuses_the_invalid_example(name: str, path: Path) -> None:
    with pytest.raises(ValidationError):
        MODELS[name].model_validate(load(path))


def test_me_answer_is_the_email_only() -> None:
    schema = load(API / "me.schema.json")
    assert schema["additionalProperties"] is False
    assert schema["required"] == ["email"]
    assert set(schema["properties"]) == {"email"}
    assert set(site_api_me.MeAnswer.model_fields) == {"email"}


@pytest.mark.parametrize(
    "extra",
    [
        {"account_id": "11111111-1111-4111-8111-111111111111"},
        {"id": "11111111-1111-4111-8111-111111111111"},
        {"other_email": "other@example.com"},
        {"sessions": []},
    ],
)
def test_me_answer_refuses_any_extra_field(extra: dict[str, Any]) -> None:
    doc = {"email": "rider@example.com", **extra}
    assert list(validator("me").iter_errors(doc)) != []
    with pytest.raises(ValidationError):
        site_api_me.MeAnswer.model_validate(doc)
