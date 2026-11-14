"""The return entry of a sign-in link request and the link it gives (ADR 0006, decisions 1, 3):
the exact shape, and the mailed link with and without it."""

from __future__ import annotations

import pytest

from player_backend.code_policy import ALPHABET
from player_backend.login_policy import is_return_entry, sign_in_link, sign_in_mail
from player_backend.token_issue import new_token

SITE = "https://player.test"
VALID = ["control", "control.BCDF-GHJK", "control.ZXWV-TSRQ"]
# Every string here is answered `invalid_return` by the request (tests/test_sign_in_return.py).
INVALID = [
    "",
    "Control",
    "CONTROL",
    "control.bcdf-ghjk",
    "control.Bcdf-GHJK",
    "control.BCDFGHJK",
    "control.BCDA-GHJK",  # a vowel
    "control.BCDE-GHJK",
    "control.BCD1-GHJK",  # a digit
    "control.BCDF-GHJKL",
    "control.BCD-GHJK",
    "control.BCDF-GHJK.x",  # an extra suffix
    "control.BCDF-GHJK&return=control",
    "controlx",
    "control.",
    "control.BCDF GHJK",
    " control",
    "control ",
    "control\n",
    "control.BCDF-GHJK\n",
    "/control",
    "/control.BCDF-GHJK",
    "https://evil.test/control",
    "//evil.test",
    "control." + "B" * 4 + "-" + "B" * 4000,  # too long
    "control" * 200,
    "pair.BCDF-GHJK",
    "classes",
    "control.ＢCDF-GHJK",  # a full-width letter
]


@pytest.mark.parametrize("value", VALID)
def test_a_return_entry_is_control_with_an_optional_code(value: str) -> None:
    assert is_return_entry(value)


@pytest.mark.parametrize("value", INVALID)
def test_anything_else_is_not_a_return_entry(value: str) -> None:
    assert not is_return_entry(value)


def test_the_code_is_any_letter_of_the_code_alphabet_and_nothing_else() -> None:
    for letter in map(chr, range(0x20, 0x7F)):
        assert is_return_entry(f"control.{letter}CDF-GHJK") is (letter in ALPHABET)


def test_without_a_return_entry_the_link_is_the_token_alone() -> None:
    token = new_token("ml")
    assert sign_in_link(SITE, token) == f"{SITE}/sign-in#{token}"
    assert sign_in_link(SITE, token, None) == f"{SITE}/sign-in#{token}"


@pytest.mark.parametrize("value", VALID)
def test_a_return_entry_follows_the_token_in_the_fragment(value: str) -> None:
    token = new_token("ml")
    assert sign_in_link(SITE, token, value) == f"{SITE}/sign-in#{token}&return={value}"


@pytest.mark.parametrize("value", INVALID)
def test_a_link_is_never_made_with_what_is_not_a_return_entry(value: str) -> None:
    with pytest.raises(ValueError, match="not a return entry"):
        sign_in_link(SITE, new_token("ml"), value)


def test_the_mail_text_is_the_same_with_or_without_a_return_entry() -> None:
    token = new_token("ml")
    plain = sign_in_mail(SITE, "rider@example.test", token)
    back = sign_in_mail(SITE, "rider@example.test", token, "control.BCDF-GHJK")
    link = f"{SITE}/sign-in#{token}"
    assert link in plain.body.split()
    assert link + "&return=control.BCDF-GHJK" in back.body.split()
    assert back.body.replace("&return=control.BCDF-GHJK", "") == plain.body
    assert (back.to, back.subject) == (plain.to, plain.subject)
    assert "BCDF-GHJK" not in back.subject and "BCDF-GHJK" not in repr(back)
