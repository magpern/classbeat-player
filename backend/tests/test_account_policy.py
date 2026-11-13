"""The pure rules of export and deletion (player_backend/account_policy.py)."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from player_backend.account_policy import (
    CONFIRM_MAX,
    EXPORT_MAX,
    EXPORT_WINDOW,
    confirmed,
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
