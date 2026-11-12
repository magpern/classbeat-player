"""Round-trip every valid vector through the generated Pydantic models."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from vectors import EXAMPLES, files, load

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "generated" / "python"))

from class_model import Class
from publication_model import Publication
from pydantic import ValidationError


def dump(model: Class | Publication) -> object:
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


@pytest.mark.parametrize("path", files(EXAMPLES / "valid"), ids=lambda p: p.name)
def test_document_round_trips(path) -> None:
    doc = load(path)
    assert dump(Class.model_validate(doc)) == doc


@pytest.mark.parametrize("path", files(EXAMPLES / "publications" / "valid"), ids=lambda p: p.name)
def test_publication_round_trips(path) -> None:
    pub = load(path)
    assert dump(Publication.model_validate(pub)) == pub


def test_generated_model_refuses_an_unknown_field() -> None:
    doc = load(EXAMPLES / "valid" / "short-class-no-music.json")
    doc["games"] = []
    with pytest.raises(ValidationError):
        Class.model_validate(doc)
