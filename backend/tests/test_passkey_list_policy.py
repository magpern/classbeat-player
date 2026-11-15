"""Whether an account may add a passkey, and how many the list may hold (ADR 0010, section 7;
ADR 0002, section 11): pure."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from player_backend import passkey_list_policy
from player_backend.own_sign_in_policy import ACCOUNT_KINDS, own_sign_in_open
from player_backend.passkey_list_policy import (
    LIST_READ_MAX,
    PasskeysOverCap,
    passkeys_open,
    within_cap,
)
from player_backend.passkey_policy import PASSKEYS_MAX


@pytest.mark.parametrize("kind", sorted(ACCOUNT_KINDS))
def test_one_row_of_a_kind_is_the_own_sign_in_rule(kind: str) -> None:
    assert passkeys_open([(kind,)]) is own_sign_in_open(kind)


def test_only_a_follower_is_open() -> None:
    assert {k for k in ACCOUNT_KINDS if passkeys_open([(k,)])} == {"follower"}


@pytest.mark.parametrize(
    "found",
    [
        [],
        [("follower",), ("follower",)],
        [("follower", "x")],
        [()],
        [(None,)],
        [("Follower",)],
    ],
)
def test_anything_but_one_row_of_an_open_kind_is_closed(found: list[tuple[object, ...]]) -> None:
    assert passkeys_open(found) is False


def test_the_read_is_one_over_the_cap() -> None:
    assert PASSKEYS_MAX == 10 and LIST_READ_MAX == 11


@pytest.mark.parametrize(("count", "shown"), [(0, True), (1, True), (10, True), (11, False)])
def test_a_list_over_the_cap_is_never_shown(count: int, shown: bool) -> None:
    assert within_cap(count) is shown


def test_a_negative_count_is_never_shown() -> None:
    assert within_cap(-1) is False


def test_the_fault_carries_no_data() -> None:
    assert str(PasskeysOverCap()) == "more passkeys than the cap"


def test_the_module_imports_no_io() -> None:
    tree = ast.parse(Path(str(passkey_list_policy.__file__)).read_text(encoding="utf-8"))
    imported = {
        alias.name if isinstance(node, ast.Import) else str(node.module)
        for node in ast.walk(tree)
        if isinstance(node, ast.Import | ast.ImportFrom)
        for alias in node.names
    }
    assert imported <= {
        "__future__",
        "collections.abc",
        "typing",
        "player_backend.own_sign_in_policy",
        "player_backend.passkey_policy",
    }
