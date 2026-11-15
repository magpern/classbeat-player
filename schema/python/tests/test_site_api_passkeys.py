"""The passkeys answer (schema/site-api/v1/passkeys.schema.json): the account's passkeys and
`can_add`, whether its kind may add one (ADR 0010, section 7), and nothing else. The JSON Schema
and the generated Pydantic model give every case the same verdict. The examples' verdicts are
checked in test_site_api.py."""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError
from vectors import V1, load

API = V1.parent.parent / "site-api" / "v1"
SCHEMA = load(API / "passkeys.schema.json")

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "generated" / "python"))

from site_api_passkeys import Passkey, PasskeysAnswer

KEY: dict[str, Any] = {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Laptop",
    "created_at": "2026-11-15T03:08:17.123456+00:00",
    "last_used_at": None,
}


def accepted(doc: Any) -> bool:
    """The verdict of the schema and the model, which must agree."""
    by_schema = not list(Draft202012Validator(SCHEMA).iter_errors(doc))
    try:
        PasskeysAnswer.model_validate(doc)
        by_model = True
    except ValidationError:
        by_model = False
    assert by_schema == by_model, doc
    return by_schema


def test_the_answer_is_the_passkeys_and_can_add_only() -> None:
    assert SCHEMA["additionalProperties"] is False
    assert SCHEMA["required"] == ["passkeys", "can_add"]
    assert set(SCHEMA["properties"]) == {"passkeys", "can_add"}
    assert SCHEMA["properties"]["can_add"] == {"type": "boolean"}
    assert set(PasskeysAnswer.model_fields) == {"passkeys", "can_add"}
    assert all(f.is_required() for f in PasskeysAnswer.model_fields.values())


def test_a_passkey_is_its_id_name_and_dates_only() -> None:
    item = SCHEMA["properties"]["passkeys"]["items"]
    assert item["additionalProperties"] is False
    assert set(item["required"]) == set(item["properties"])
    assert set(item["properties"]) == {"id", "name", "created_at", "last_used_at"}
    assert set(Passkey.model_fields) == {"id", "name", "created_at", "last_used_at"}
    assert all(f.is_required() for f in Passkey.model_fields.values())


@pytest.mark.parametrize("can_add", [True, False])
def test_can_add_is_true_or_false(can_add: bool) -> None:
    doc = {"passkeys": [KEY], "can_add": can_add}
    assert accepted(doc)
    assert PasskeysAnswer.model_validate(doc).model_dump(mode="json") == doc
    assert PasskeysAnswer(passkeys=[], can_add=can_add).can_add is can_add


@pytest.mark.parametrize("can_add", [None, "true", "false", "", 1, 0, [], {}])
def test_can_add_is_nothing_else(can_add: Any) -> None:
    assert not accepted({"passkeys": [], "can_add": can_add})


def test_can_add_is_never_left_out() -> None:
    assert not accepted({"passkeys": []})
    assert not accepted({"can_add": False})


@pytest.mark.parametrize(
    "extra",
    [
        {"kind": "instructor"},
        {"account_kind": "instructor"},
        {"account_id": "11111111-1111-4111-8111-111111111111"},
        {"email": "rider@example.com"},
        {"can_remove": True},
    ],
)
def test_the_answer_refuses_any_extra_field(extra: dict[str, Any]) -> None:
    assert not accepted({"passkeys": [], "can_add": False, **extra})


@pytest.mark.parametrize(
    "extra",
    [
        {"credential_id": "AAAAAAAAAAAAAAAAAAAAAA"},
        {"public_key": "pQECAyYgASFYIA"},
        {"sign_count": 0},
        {"transports": ["internal"]},
        {"account_id": "11111111-1111-4111-8111-111111111111"},
    ],
)
def test_a_passkey_never_carries_its_credential_or_key(extra: dict[str, Any]) -> None:
    assert not accepted({"passkeys": [{**KEY, **extra}], "can_add": False})


def test_at_most_ten_passkeys() -> None:
    ten = [{**KEY, "id": f"{n:08x}-1111-4111-8111-111111111111"} for n in range(10)]
    assert accepted({"passkeys": ten, "can_add": True})
    assert not accepted({"passkeys": [*ten, KEY], "can_add": True})


@pytest.mark.parametrize(
    ("field", "value", "ok"),
    [
        ("name", "k", True),
        ("name", "x" * 40, True),
        ("name", "", False),
        ("name", "x" * 41, False),
        ("id", "11111111111141118111111111111111", False),
        ("id", "A1111111-1111-4111-8111-111111111111", False),
        ("created_at", "2026-11-15T03:08:17Z", True),
        ("created_at", "2026-11-15T03:08:17", False),
        ("created_at", None, False),
        ("last_used_at", "2026-11-15T08:30:05+01:00", True),
        ("last_used_at", "never", False),
    ],
)
def test_passkey_fields(field: str, value: Any, ok: bool) -> None:
    assert accepted({"passkeys": [{**KEY, field: value}], "can_add": False}) is ok


@pytest.mark.parametrize(
    "when",
    [
        datetime(2026, 11, 15, 3, 8, 17, tzinfo=UTC),
        datetime(2026, 11, 15, 3, 8, 17, 123456, tzinfo=UTC),
        datetime(2026, 11, 15, 3, 8, 17, 1, tzinfo=timezone(timedelta(hours=1))),
    ],
)
def test_the_backends_isoformat_dates_are_accepted(when: datetime) -> None:
    # The backend writes a stored timestamptz with `datetime.isoformat()`, with or without
    # microseconds.
    key = {**KEY, "created_at": when.isoformat(), "last_used_at": when.isoformat()}
    assert accepted({"passkeys": [key], "can_add": False})
