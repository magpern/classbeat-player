"""Every shared vector must give the same verdict here and in the TypeScript tests."""

from __future__ import annotations

import pytest
from vectors import CLASS_SCHEMA, EXAMPLES, PUBLICATION_SCHEMA, files, load

from classformat import (
    Incoming,
    Stored,
    check_document,
    check_publication,
    check_warnings,
    content_hash,
    decide,
    reader_schema,
)

VALID = files(EXAMPLES / "valid")
INVALID = files(EXAMPLES / "invalid")
INVALID_EXPECT = load(EXAMPLES / "invalid" / "expected.json")
READER = files(EXAMPLES / "reader")
READER_EXPECT = load(EXAMPLES / "reader" / "expected.json")
PUB_VALID = files(EXAMPLES / "publications" / "valid")
PUB_INVALID = files(EXAMPLES / "publications" / "invalid")
PUB_EXPECT = load(EXAMPLES / "publications" / "invalid" / "expected.json")


def judge(found: list[tuple[str, str]], expected: list[list[str]]) -> None:
    """Schema failures must name the expected place; semantic ones match exactly."""
    if expected and expected[0][0] == "schema":
        assert ("schema", expected[0][1]) in found
    else:
        assert found == [(c, p) for c, p in expected]


def test_every_invalid_vector_has_an_expectation_and_back() -> None:
    assert sorted(INVALID_EXPECT) == [p.name for p in INVALID]
    assert sorted(PUB_EXPECT) == [p.name for p in PUB_INVALID]
    assert sorted(READER_EXPECT) == [p.name for p in READER]


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.name)
def test_valid_documents_pass_in_both_modes(path) -> None:
    doc = load(path)
    assert check_document(CLASS_SCHEMA, doc, "strict") == []
    assert check_document(CLASS_SCHEMA, doc, "reader") == []


WARNING_EXPECT = load(EXAMPLES / "warnings.json")


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.name)
def test_warnings_of_a_valid_document(path) -> None:
    """Warnings never make a document invalid; each valid vector has its expected warnings."""
    expected = [(c, p) for c, p in WARNING_EXPECT.get(path.name, [])]
    assert check_warnings(load(path)) == expected


def test_pattern_document_is_1_1_and_labelled_1_0_is_refused() -> None:
    doc = load(EXAMPLES / "valid" / "class-pattern-climb-and-jumps.json")
    assert doc["format_version"] == "1.1"
    assert check_document(CLASS_SCHEMA, doc, "strict") == []
    doc["format_version"] = "1.0"
    for mode in ("strict", "reader"):
        assert check_document(CLASS_SCHEMA, doc, mode) != []


@pytest.mark.parametrize("kind", ["colons-22", "quote-22", "space-22", "trailing-newline", "uri"])
def test_playlist_id_of_right_length_but_not_alphanumeric_is_refused(kind) -> None:
    doc = load(EXAMPLES / "invalid" / f"schema-spotify-playlist-{kind}.json")
    for mode in ("strict", "reader"):
        assert ("schema", "/music/spotify_playlist") in check_document(CLASS_SCHEMA, doc, mode)


def test_playlist_document_is_1_2_and_older_labels_are_refused() -> None:
    doc = load(EXAMPLES / "valid" / "class-spotify-playlist.json")
    assert doc["format_version"] == "1.2"
    assert check_document(CLASS_SCHEMA, doc, "strict") == []
    for old in ("1.0", "1.1"):
        doc["format_version"] = old
        for mode in ("strict", "reader"):
            assert check_document(CLASS_SCHEMA, doc, mode) != []


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_documents_fail_for_the_named_rule(path) -> None:
    found = check_document(CLASS_SCHEMA, load(path), "strict")
    assert found, "must be rejected"
    judge(found, INVALID_EXPECT[path.name])


@pytest.mark.parametrize("path", READER, ids=lambda p: p.name)
def test_reader_vectors(path) -> None:
    doc = load(path)
    expected = READER_EXPECT[path.name]
    assert check_document(CLASS_SCHEMA, doc, "reader") == [(c, p) for c, p in expected]


def test_producer_is_strict_where_reader_is_lax() -> None:
    doc = load(EXAMPLES / "reader" / "accepted-future-minor-unknown-fields.json")
    assert check_document(CLASS_SCHEMA, doc, "strict") != []
    doc["format_version"] = "1.0"
    assert check_document(CLASS_SCHEMA, doc, "strict") != []
    assert check_document(CLASS_SCHEMA, doc, "reader") == []


def test_reader_schema_is_derived_not_a_second_source() -> None:
    lax = reader_schema(CLASS_SCHEMA)
    assert "additionalProperties" not in lax
    assert CLASS_SCHEMA["additionalProperties"] is False  # the input is untouched


@pytest.mark.parametrize("path", PUB_VALID, ids=lambda p: p.name)
def test_valid_publications(path) -> None:
    pub = load(path)
    assert check_publication(CLASS_SCHEMA, PUBLICATION_SCHEMA, pub, "strict") == []
    assert check_publication(CLASS_SCHEMA, PUBLICATION_SCHEMA, pub, "reader") == []


@pytest.mark.parametrize("path", PUB_INVALID, ids=lambda p: p.name)
def test_invalid_publications(path) -> None:
    found = check_publication(CLASS_SCHEMA, PUBLICATION_SCHEMA, load(path), "strict")
    assert found, "must be rejected"
    judge(found, PUB_EXPECT[path.name])


def test_content_hash_is_the_rfc8785_form() -> None:
    # Key order and spacing must not matter; RFC 8785 sorts keys and drops whitespace.
    assert content_hash({"b": 1, "a": [1.5, "x"]}) == content_hash({"a": [1.5, "x"], "b": 1})
    # Known digest of the canonical text {"a":[1.5,"x"],"b":1}.
    assert (
        content_hash({"b": 1, "a": [1.5, "x"]})
        == "sha256:27edd5497e48a293750749399a10333aae187927cecaf38c5ac50f54bbaa13b7"
    )


@pytest.mark.parametrize("case", load(EXAMPLES / "sequences.json"), ids=lambda c: c["name"])
def test_publication_sequence(case) -> None:
    s = case["stored"]
    stored = None if s is None else Stored(s["number"], s["removed"], s["content_hash"])
    i = case["incoming"]
    incoming = Incoming(i["number"], i["removed"], i["content_hash"])
    assert decide(stored, incoming) == case["expect"]


def test_swedebeat_mix_document_is_1_3_and_older_labels_are_refused() -> None:
    doc = load(EXAMPLES / "valid" / "class-swedebeat-mix.json")
    assert doc["format_version"] == "1.3"
    for mode in ("strict", "reader"):
        assert check_document(CLASS_SCHEMA, doc, mode) == []
    for old in ("1.0", "1.1", "1.2"):
        doc["format_version"] = old
        for mode in ("strict", "reader"):
            assert check_document(CLASS_SCHEMA, doc, mode) != []


def test_swedebeat_mix_may_end_exactly_where_the_class_ends_and_offset_defaults() -> None:
    doc = load(EXAMPLES / "valid" / "class-swedebeat-mix-no-offset-exact-fit.json")
    assert "offset_ms" not in doc["music"]["swedebeat_mix"]
    assert doc["music"]["swedebeat_mix"]["length_ms"] == doc["class"]["length_ms"]
    assert check_document(CLASS_SCHEMA, doc, "strict") == []
    doc["music"]["swedebeat_mix"]["length_ms"] -= 1
    assert ("swedebeat_mix_too_short", "/music/swedebeat_mix/length_ms") in check_document(
        CLASS_SCHEMA, doc, "strict"
    )


@pytest.mark.parametrize("mix_id", ["a", "a" * 64, "Mix_1-b", "0123456789"])
def test_swedebeat_mix_id_bounds_accepted(mix_id) -> None:
    doc = load(EXAMPLES / "valid" / "class-swedebeat-mix.json")
    doc["music"]["swedebeat_mix"]["id"] = mix_id
    assert check_document(CLASS_SCHEMA, doc, "strict") == []


@pytest.mark.parametrize("mix_id", ["", "a" * 65, "a.b", "a b", "a/b", "a\n", "\nabc", "é"])
def test_swedebeat_mix_id_outside_the_alphabet_refused_in_both_modes(mix_id) -> None:
    doc = load(EXAMPLES / "valid" / "class-swedebeat-mix.json")
    doc["music"]["swedebeat_mix"]["id"] = mix_id
    for mode in ("strict", "reader"):
        assert ("schema", "/music/swedebeat_mix/id") in check_document(CLASS_SCHEMA, doc, mode)


def test_older_reader_ignores_the_mix_in_a_future_minor() -> None:
    doc = load(EXAMPLES / "valid" / "class-swedebeat-mix.json")
    doc["format_version"] = "1.5"
    doc["music"]["swedebeat_mix"]["future"] = 1
    assert check_document(CLASS_SCHEMA, doc, "reader") == []


def test_local_file_name_bounds_accepted() -> None:
    for name in ("a", "x" * 255, "Song – é.mp3", "a.b c"):
        doc = load(EXAMPLES / "valid" / "class-local-files.json")
        doc["songs"][0]["ids"]["local_file"]["file_name"] = name
        assert check_document(CLASS_SCHEMA, doc, "strict") == [], name


def test_local_file_refused_in_both_modes_when_label_is_before_1_4() -> None:
    doc = load(EXAMPLES / "valid" / "class-local-files.json")
    doc["format_version"] = "1.3"
    for mode in ("strict", "reader"):
        found = check_document(CLASS_SCHEMA, doc, mode)
        assert ("schema", "/music/source") in found, mode


def test_local_file_class_is_accepted_in_reader_mode() -> None:
    doc = load(EXAMPLES / "valid" / "class-local-files.json")
    doc["songs"][0]["ids"]["local_file"]["future"] = 1
    assert check_document(CLASS_SCHEMA, doc, "reader") == []
