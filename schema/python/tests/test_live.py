"""The live contract (schema/live/v1, ADR 0005 section 4): every schema has valid and invalid
examples, every example gets its verdict from the JSON Schema, and every valid one round-trips
through the generated Pydantic model."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any

import pytest
from live_vectors import EXAMPLES, examples, load, names, schema, validator
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "generated" / "python"))


def model(name: str) -> Any:
    module = importlib.import_module("live_" + name.replace("-", "_"))
    return getattr(module, schema(name)["title"])


def cases(kind: str) -> list[Any]:
    return [
        pytest.param(name, path, id=f"{name}/{path.name}")
        for name in names()
        for path in examples(name, kind)
    ]


def test_the_live_contract_has_every_schema_of_adr_0005() -> None:
    assert names() == sorted(
        [
            # HTTP bodies and answers
            "session-answer",
            "controller-request",
            "control-request",
            "controller-answer",
            "error",
            # WebSocket messages
            "hello",
            "welcome",
            "host-status",
            "controller-joined",
            "controller-left",
            "make-code",
            "control-code",
            "code-cancelled",
            "drop",
            "companion-state",
            "command",
            "command-forwarded",
            "command-result",
            "ack",
            "end",
            "ended",
            # Riders (ADR 0007 section 2): the join route and the WebSocket messages
            "join-request",
            "join-answer",
            "welcome-rider",
            "rider-state",
            "rider-joined",
            "rider-left",
            "drop-rider",
            "lock",
            "lock-state",
            "new-join-code",
            "join-code",
        ]
    )


def test_every_schema_has_a_valid_and_an_invalid_example() -> None:
    for name in names():
        assert examples(name, "valid"), name
        assert examples(name, "invalid"), name
    assert sorted(p.name for p in EXAMPLES.iterdir()) == names()


@pytest.mark.parametrize(("name", "path"), cases("valid"))
def test_valid_example_passes(name: str, path: Path) -> None:
    assert list(validator(name).iter_errors(load(path))) == []


@pytest.mark.parametrize(("name", "path"), cases("invalid"))
def test_invalid_example_is_refused(name: str, path: Path) -> None:
    assert list(validator(name).iter_errors(load(path))) != []


@pytest.mark.parametrize(("name", "path"), cases("valid"))
def test_valid_example_round_trips_through_the_generated_model(name: str, path: Path) -> None:
    doc = load(path)
    parsed = model(name).model_validate(doc)
    assert parsed.model_dump(mode="json", by_alias=True, exclude_unset=True) == doc


def test_generated_command_model_refuses_a_slot() -> None:
    doc = load(EXAMPLES / "command" / "valid" / "pause.json")
    model("command").model_validate(doc)
    with pytest.raises(ValidationError):
        model("command").model_validate({**doc, "slot": 1})


def test_generated_models_refuse_an_unknown_field() -> None:
    for name in names():
        doc = load(examples(name, "valid")[0])
        with pytest.raises(ValidationError):
            model(name).model_validate({**doc, "extra": 1})
