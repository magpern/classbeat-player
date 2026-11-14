"""The bound on a sign-in link request's return entry (#397, from the #395 review): it is above
the longest entry accepted, and a longer string is not a return entry and never reaches the
pattern; the request model holds no longer string either (#407). Through the site's API, with
the order of the answers: tests/test_sign_in_return.py."""

from __future__ import annotations

import re

import pytest
from pydantic import ValidationError

from player_backend import login_policy
from player_backend.login_policy import RETURN_MAX, bounded_return, is_return_entry
from player_backend.site.sign_in import LinkRequest
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


# -- the same bound at the request model (#407, from the #395 review) ------------------------


@pytest.mark.parametrize("value", [None, "", "control", "x" * RETURN_MAX, *VALID, *PLAY_VALID])
def test_the_model_holds_a_value_within_the_bound_as_it_is(value: str | None) -> None:
    held = LinkRequest.model_validate({"email": "a@b.test", "return_to": value}).return_to
    assert held == value
    assert bounded_return(value) == value


OVER = ["x" * (RETURN_MAX + 1), VALID[0] + "x" * RETURN_MAX, "control" * 16000]


@pytest.mark.parametrize("value", OVER)
def test_the_model_holds_no_value_over_the_bound(value: str) -> None:
    held = LinkRequest.model_validate({"email": "a@b.test", "return_to": value}).return_to
    # Cut to one past the bound: still no return entry, so `invalid_return` in its order.
    assert held == value[: RETURN_MAX + 1]
    assert held is not None and len(held) == RETURN_MAX + 1
    assert not is_return_entry(held)


@pytest.mark.parametrize("value", [7, ["control"], {"a": "control"}, True])
def test_the_model_leaves_a_value_that_is_not_a_string_to_its_own_check(value: object) -> None:
    assert bounded_return(value) is value
    with pytest.raises(ValidationError):
        LinkRequest.model_validate({"email": "a@b.test", "return_to": value})
