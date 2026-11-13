"""The pure rules of export and deletion (player_backend/account_policy.py)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest

from player_backend.account_policy import (
    CONFIRM_MAX,
    EXPORT_MAX,
    EXPORT_PAGE,
    EXPORT_WINDOW,
    ExportStopped,
    class_entry,
    confirmed,
    export_chunks,
    export_limit_key,
)

EMAIL = "rider@example.test"


def test_the_export_limit_is_three_a_day() -> None:
    assert (EXPORT_MAX, EXPORT_WINDOW) == (3, timedelta(days=1))


def test_the_export_counter_is_a_hash_of_the_account_and_its_own() -> None:
    one, other = uuid.uuid4(), uuid.uuid4()
    key = export_limit_key(one)
    assert len(key) == 32 and key == export_limit_key(one) != export_limit_key(other)
    assert one.bytes not in key and one.hex.encode() not in key


@pytest.mark.parametrize("typed", [EMAIL, " Rider@Example.Test ", "RIDER@EXAMPLE.TEST\n"])
def test_the_accounts_email_is_a_confirmation(typed: str) -> None:
    assert confirmed(typed, EMAIL)


@pytest.mark.parametrize(
    "typed",
    [
        "",
        " ",
        "rider@example",
        "rider@example.test.",
        "other@example.test",
        "r ider@example.test",
        EMAIL + " " * CONFIRM_MAX,
    ],
)
def test_anything_else_is_not(typed: str) -> None:
    assert not confirmed(typed, EMAIL)


HEAD: dict[str, object] = {
    "format": 1,
    "exported_at": "2026-11-13T10:00:00+00:00",
    "account": {"email": EMAIL, "created_at": None},
    "devices": [{"name": 'Gym "PC" åäö'}],
    "audit_events": [],
}


@pytest.mark.parametrize("count", [0, 1, 3])
def test_the_streamed_export_is_the_whole_document(count: int) -> None:
    classes: list[dict[str, object]] = [
        {"source_class_id": f"c{n}", "document": {"title": "— \U0001f6b4", "n": n}}
        for n in range(count)
    ]
    text = b"".join(export_chunks(HEAD, classes))
    assert json.loads(text) == {**HEAD, "classes": classes}


def test_a_stopped_stream_is_not_valid_json() -> None:
    def stopped() -> Iterator[dict[str, object]]:
        yield {"source_class_id": "c0"}
        raise ExportStopped

    sent: list[bytes] = []
    with pytest.raises(ExportStopped):
        sent.extend(export_chunks(HEAD, stopped()))
    with pytest.raises(json.JSONDecodeError):
        json.loads(b"".join(sent))


def test_a_class_entry_names_its_columns() -> None:
    published = datetime(2026, 11, 13, tzinfo=UTC)
    entry = class_entry(("classbeat", "c0", 2, "removal", published, None))
    assert entry == {
        "source": "classbeat",
        "source_class_id": "c0",
        "publication_number": 2,
        "removed": True,
        "published_at": published.isoformat(),
        "document": None,
    }
    assert EXPORT_PAGE == 16
