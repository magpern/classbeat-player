"""The reference converter: each fixture gives its expected document, which the validator accepts."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from classformat import check_document

from reference_converter import ConversionError, convert

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures"
SCHEMA = json.loads(
    (HERE.parent / "class-format" / "v1" / "class.schema.json").read_text(encoding="utf-8")
)
NAMES = sorted(p.name.removesuffix(".input.json") for p in FIXTURES.glob("*.input.json"))


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def test_three_fixtures_exist_and_each_has_an_expectation() -> None:
    assert len(NAMES) >= 3
    assert (
        sorted(p.name.removesuffix(".expected.json") for p in FIXTURES.glob("*.expected.json"))
        == NAMES
    )


@pytest.mark.parametrize("name", NAMES)
def test_fixture_converts_to_its_expected_document(name: str) -> None:
    fixture = load(FIXTURES / f"{name}.input.json")
    before = copy.deepcopy(fixture)
    assert convert(fixture) == load(FIXTURES / f"{name}.expected.json")
    assert fixture == before, "the converter must not change its input"


@pytest.mark.parametrize("name", NAMES)
def test_converted_document_is_valid_strict_and_reader(name: str) -> None:
    doc = convert(load(FIXTURES / f"{name}.input.json"))
    assert check_document(SCHEMA, doc, "strict") == []
    assert check_document(SCHEMA, doc, "reader") == []


def test_crossfade_nine_seconds_overlaps_windows_and_is_stated() -> None:
    doc = load(FIXTURES / "class-45min-crossfade-9s.expected.json")
    assert doc["music"]["design_crossfade_ms"] == 9000
    assert all(s["length_ms"] - (s["end_ms"] - s["start_ms"]) == 9000 for s in doc["songs"])


def test_crossfade_off_gives_windows_as_long_as_the_songs() -> None:
    doc = load(FIXTURES / "class-30min-crossfade-off.expected.json")
    assert doc["music"]["design_crossfade_ms"] == 0
    assert all(s["length_ms"] == s["end_ms"] - s["start_ms"] for s in doc["songs"][:-1])


def test_game_is_dropped_and_ftp_test_is_kept() -> None:
    fixture = load(FIXTURES / "class-40min-game-and-ftp-test.input.json")
    assert any("game" in i for s in fixture["segments"] for i in s["intervals"])
    doc = convert(fixture)
    assert all("game" not in i for i in doc["intervals"])
    tests = [i["test"] for i in doc["intervals"] if "test" in i]
    assert tests == [{"kind": "ftp", "minutes": 20}]


def test_soundless_class_is_source_none_with_missing_timing() -> None:
    fixture = load(FIXTURES / "class-45min-crossfade-9s.input.json")
    del fixture["music"]
    doc = convert(fixture)
    assert doc["music"] == {
        "source": "none",
        "design_crossfade_ms": 0,
        "song_timing": "missing",
    }
    assert doc["songs"] == []
    assert check_document(SCHEMA, doc, "strict") == []


def test_running_class_maps_gradient_to_incline() -> None:
    fixture = {
        "name": "Run",
        "sport": "running",
        "segments": [
            {
                "name": "Main",
                "kind": "main",
                "intervals": [
                    {"sec": 300, "zone": 2, "gradient": 0, "cue": ""},
                    {"sec": 300, "zone": 4, "gradient": 1, "cue": "Hills"},
                ],
            }
        ],
    }
    doc = convert(fixture)
    assert [i["incline"] for i in doc["intervals"]] == ["flat", "raised"]
    assert all("cadence" not in i and "position" not in i for i in doc["intervals"])
    assert check_document(SCHEMA, doc, "strict") == []


def test_long_title_is_cut_to_the_format_limit() -> None:
    fixture = load(FIXTURES / "class-30min-crossfade-off.input.json")
    fixture["name"] = "x" * 100
    assert len(convert(fixture)["class"]["title"]) == 80


def test_songs_that_cannot_fill_the_class_are_refused() -> None:
    fixture = load(FIXTURES / "class-30min-crossfade-off.input.json")
    fixture["music"]["songs"] = fixture["music"]["songs"][:2]  # last window would pass its length
    with pytest.raises(ConversionError):
        convert(fixture)
