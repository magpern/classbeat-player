"""The pure rules of a publication as it arrives (publication_policy.py): the envelope, the
document against the contract lane's schemas, the content hash, the sizes and the outcomes."""

from __future__ import annotations

import json

import pytest
import rfc8785

from player_backend.class_schemas import schemas
from player_backend.publication_policy import (
    DOCUMENT_MAX,
    Publication,
    Refusal,
    check,
    content_hash,
    outcome,
)
from tests.sourcehelp import document, envelope


def _check(body: object) -> Publication | Refusal:
    return check(json.dumps(body).encode(), *schemas())


def test_a_class_is_kept_in_its_canonical_form_with_its_hash() -> None:
    doc = document()
    found = _check(envelope("c1", 3, doc))
    assert found == Publication(
        "c1", 3, False, content_hash(doc), rfc8785.dumps(doc).decode("utf-8")
    )


def test_a_removal_carries_no_hash_and_no_document() -> None:
    assert _check(envelope("c1", 3, None)) == Publication("c1", 3, True, None, None)


def test_a_newer_minor_with_fields_this_backend_does_not_know_is_accepted() -> None:
    doc = {**document(), "format_version": "1.7", "later_field": {"x": 1}}
    found = _check(envelope("c1", 1, doc))
    assert isinstance(found, Publication) and found.content_hash == content_hash(doc)


@pytest.mark.parametrize(
    "unknown",
    [{"later\x00field": 1}, {"later_field": {"x\x00": 1}}, {"later_field": [{"\x00": "y"}]}],
)
def test_a_nul_in_a_key_the_backend_does_not_know_is_refused(unknown: dict[str, object]) -> None:
    # Readers' mode keeps unknown fields, so the key would reach `jsonb`, which cannot hold it.
    doc = {**document(), "format_version": "1.7", **unknown}
    assert _check(envelope("c1", 1, doc)) == Refusal(422, "invalid_publication")


@pytest.mark.parametrize(
    "raw",
    [
        b"",
        b"[]",
        b"not json",
        b'{"source_class_id": "a", "source_class_id": "b", "publication_number": 1, '
        b'"removed": true}',
        b'{"source_class_id": "a", "publication_number": NaN, "removed": true}',
        b'{"source_class_id": "a", "publication_number": 1, "removed": true, "x": Infinity}',
        b"[" * 100000,
    ],
)
def test_what_is_not_one_json_object_is_refused(raw: bytes) -> None:
    assert check(raw, *schemas()) == Refusal(422, "invalid_publication")


def test_a_document_is_measured_in_its_stored_form() -> None:
    # A field of a later minor, which a reader ignores, makes it exactly 1 MiB.
    doc = {**document(), "padding": ""}
    doc["padding"] = "x" * (DOCUMENT_MAX - len(rfc8785.dumps(doc)))
    assert len(rfc8785.dumps(doc)) == DOCUMENT_MAX
    assert isinstance(_check(envelope("c1", 1, doc)), Publication)
    doc["padding"] += "x"
    assert _check(envelope("c1", 1, doc)) == Refusal(413, "document_too_large")


def test_a_number_the_canonical_form_cannot_hold_is_refused() -> None:
    body = envelope("c1", 1, document())
    body["document"]["class"]["length_ms"] = 2**60
    assert _check(body) == Refusal(422, "invalid_publication")


@pytest.mark.parametrize(
    ("highest", "removal", "stored", "number", "removed", "incoming", "expected"),
    [
        (0, False, None, 1, False, "h1", "accepted"),
        (0, False, None, 1, True, None, "accepted"),
        (2, False, "h1", 3, False, "h2", "accepted"),
        (2, True, None, 3, False, "h1", "accepted"),
        (2, False, "h1", 2, False, "h1", "repeat"),
        (2, True, None, 2, True, None, "repeat"),
        (2, False, "h1", 2, False, "h2", "conflict"),
        (2, False, "h1", 2, True, None, "conflict"),
        (2, True, None, 2, False, "h1", "conflict"),
        (2, False, "h1", 1, False, "h1", "stale"),
        (2, True, None, 1, False, "h1", "stale"),
    ],
)
def test_the_outcomes(
    highest: int,
    removal: bool,
    stored: str | None,
    number: int,
    removed: bool,
    incoming: str | None,
    expected: str,
) -> None:
    pub = Publication("c1", number, removed, incoming, None if removed else "{}")
    assert outcome(highest, removal, stored, pub) == expected
