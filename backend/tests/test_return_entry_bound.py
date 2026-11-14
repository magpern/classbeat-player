"""The bound on a sign-in link request's return entry (#397, from the #395 review): it is above
the longest entry accepted, and a longer string is not a return entry and never reaches the
pattern. Through the site's API: tests/test_sign_in_return.py."""

from __future__ import annotations

import re

import pytest

from player_backend import login_policy
from player_backend.login_policy import RETURN_MAX, is_return_entry
from tests.test_play_return_entry_policy import PLAY_VALID
from tests.test_return_entry_policy import VALID


class Spy:
    """A pattern that matches everything, and records what it was given."""

    def __init__(self) -> None:
        self.seen: list[str] = []

    def fullmatch(self, raw: str) -> re.Match[str] | None:
        self.seen.append(raw)
        return re.fullmatch(".*", raw, re.DOTALL)


def test_the_bound_is_above_the_longest_entry_accepted() -> None:
    longest = max(len(value) for value in VALID + PLAY_VALID)
    assert longest == len("play.") + 36
    assert longest < RETURN_MAX
    for value in VALID + PLAY_VALID:
        assert is_return_entry(value)


def test_over_the_bound_the_pattern_is_not_run(monkeypatch: pytest.MonkeyPatch) -> None:
    spy = Spy()
    monkeypatch.setattr(login_policy, "RETURN_ENTRY", spy)
    at, over = "x" * RETURN_MAX, "x" * (RETURN_MAX + 1)
    assert is_return_entry(at)  # the spy matches anything it is given
    assert not is_return_entry(over)
    assert not is_return_entry("control" + "x" * 16000)
    assert spy.seen == [at]
