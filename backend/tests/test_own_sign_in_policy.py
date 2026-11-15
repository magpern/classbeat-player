"""Which account kinds the email link and passkeys are open for (ADR 0010, section 7): pure."""

from __future__ import annotations

import pytest

from player_backend.own_sign_in_policy import ACCOUNT_KINDS, OWN_SIGN_IN_KINDS, own_sign_in_open


def test_only_follower_is_open_and_it_is_a_kind() -> None:
    assert OWN_SIGN_IN_KINDS == frozenset({"follower"})
    assert OWN_SIGN_IN_KINDS <= ACCOUNT_KINDS


@pytest.mark.parametrize("kind", sorted(ACCOUNT_KINDS - OWN_SIGN_IN_KINDS))
def test_every_kind_there_is_today_is_closed(kind: str) -> None:
    assert own_sign_in_open(kind) is False


def test_a_follower_is_open() -> None:
    assert own_sign_in_open("follower") is True


@pytest.mark.parametrize("kind", [None, "", "Follower", " follower", "admin", 1, b"follower"])
def test_anything_else_is_closed(kind: object) -> None:
    assert own_sign_in_open(kind) is False
