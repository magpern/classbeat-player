"""The pure rules that turn a credentialed request's raw text into values (param_policy.py)."""

from __future__ import annotations

from uuid import UUID

import pytest
from pydantic import BaseModel, Field

from player_backend.param_policy import is_json, json_body_of, source_class_id_of, uuid_of


def test_an_id_in_its_canonical_form_only() -> None:
    canonical = "1a2b3c4d-0000-4000-8000-00000000000f"
    assert uuid_of(canonical) == UUID(canonical)
    assert uuid_of(canonical.upper()) == UUID(canonical)
    for raw in (
        "",
        "not-an-id",
        canonical.replace("-", ""),
        "{" + canonical + "}",
        "urn:uuid:" + canonical,
        canonical + "\n",
        " " + canonical,
        canonical[:-1] + "g",
        canonical.replace("0", "０", 1),
    ):
        assert uuid_of(raw) is None, raw


def test_a_source_class_id_from_the_path() -> None:
    for raw in ("c", "c1", "x" * 100, "é" * 100, "a b"):
        assert source_class_id_of(raw) == raw
    for raw in ("", "x" * 101, "c\x00", "\x00"):
        assert source_class_id_of(raw) is None, raw


@pytest.mark.parametrize(
    ("content_type", "json"),
    [
        ("application/json", True),
        ("Application/JSON; charset=utf-8", True),
        ("application/problem+json", True),
        (None, False),
        ("", False),
        ("text/plain", False),
        ("text/json", False),
        ("application/x-www-form-urlencoded", False),
        ("multipart/form-data; boundary=x", False),
        ("application/jsonx", False),
    ],
)
def test_a_body_sent_as_json(content_type: str | None, json: bool) -> None:
    assert is_json(content_type) is json


class _Body(BaseModel):
    code: str = Field(max_length=5)
    approve: bool


def test_a_json_body_as_its_model() -> None:
    ok = "application/json"
    assert json_body_of(_Body, ok, b'{"code": "ab", "approve": true}') == _Body(
        code="ab", approve=True
    )
    for raw in (
        b"",
        b"not json",
        b"[]",
        b'{"code": "ab"}',
        b'{"code": "abcdef", "approve": true}',
        b'{"code": 5, "approve": true}',
        b'{"code": "ab", "approve": "maybe"}',
        b'{"code": "ab", "approve": true',
        b"\xff\xfe",
        b"[" * 100000,
    ):
        assert json_body_of(_Body, ok, raw) is None, raw
    assert json_body_of(_Body, "text/plain", b'{"code": "ab", "approve": true}') is None
