"""The `play` return entry of a sign-in link request (ADR 0008, section 3, amending ADR 0006,
decision 1): `play`, or `play.` and a class id as a canonical lower-case uuid, matched exactly."""

from __future__ import annotations

import uuid

import pytest

from player_backend.login_policy import RETURN_ENTRY, is_return_entry, sign_in_link
from player_backend.token_issue import new_token

SITE = "https://player.test"
# ADR 0008, section 3, character for character.
ADR_PATTERN = (
    r"^(control(\.[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4})?"
    r"|play(\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)$"
)
CLASS_ID = "3f2a9c4e-8b1d-4e6f-a0c7-5d9e1b2f4a68"
PLAY_VALID = [
    "play",
    "play." + CLASS_ID,
    "play.00000000-0000-0000-0000-000000000000",
    "play.ffffffff-ffff-ffff-ffff-ffffffffffff",
]
# Every string here is answered `invalid_return` by the request (tests/test_sign_in_play_return.py).
PLAY_INVALID = [
    "play." + CLASS_ID.upper(),  # an id in upper case
    "play.3F2a9c4e-8b1d-4e6f-a0c7-5d9e1b2f4a68",  # one upper-case letter
    "play." + CLASS_ID[:-1],  # a short id
    "play." + CLASS_ID + "0",  # one more character
    "play.",
    "play ",
    "Play",
    "PLAY",
    "play.{" + CLASS_ID + "}",  # braces
    "play." + CLASS_ID.replace("-", ""),  # no hyphens
    "play.3f2a9c4e8-b1d-4e6f-a0c7-5d9e1b2f4a68",  # a hyphen out of place
    "play.3f2a9c4e-8b1d-4e6f-a0c75d9e-1b2f4a68",
    "play.3f2a9c4g-8b1d-4e6f-a0c7-5d9e1b2f4a68",  # not a hex digit
    "play.urn:uuid:" + CLASS_ID,
    "play." + CLASS_ID + "\n",
    "play\n",
    " play",
    "play. " + CLASS_ID,
    "play." + CLASS_ID + " ",
    "play." + CLASS_ID + ".x",
    "play." + CLASS_ID + "&return=control",
    "play#" + CLASS_ID,
    "play/" + CLASS_ID,
    "/play",
    "/play#" + CLASS_ID,
    "playx",
    "play.BCDF-GHJK",  # a class code is not a class id
    "control." + CLASS_ID,  # nor the other way round
    "control.play",
    "playcontrol",
    "controlplay",
    "play.3f2a9c4e-8b1d-4e6f-a0c7-5d9e1b2f4a6８",  # a full-width digit
    "play." + CLASS_ID + CLASS_ID,
    "play." * 200,
]


def test_the_pattern_is_the_one_of_adr_0008() -> None:
    assert f"^({RETURN_ENTRY.pattern})$" == ADR_PATTERN
    assert RETURN_ENTRY.flags & ~0x20 == 0  # re.UNICODE alone: no IGNORECASE, no VERBOSE


@pytest.mark.parametrize("value", PLAY_VALID)
def test_play_with_an_optional_class_id_is_a_return_entry(value: str) -> None:
    assert is_return_entry(value)


def test_a_new_class_id_is_a_return_entry() -> None:
    for _ in range(50):
        assert is_return_entry(f"play.{uuid.uuid4()}")


@pytest.mark.parametrize("value", PLAY_INVALID)
def test_anything_else_after_play_is_not_a_return_entry(value: str) -> None:
    assert not is_return_entry(value)


def test_each_place_of_the_class_id_is_a_lower_case_hex_digit_and_nothing_else() -> None:
    for place, char in enumerate(CLASS_ID):
        for other in map(chr, range(0x20, 0x7F)):
            changed = CLASS_ID[:place] + other + CLASS_ID[place + 1 :]
            expected = other == "-" if char == "-" else other in "0123456789abcdef"
            assert is_return_entry("play." + changed) is expected, (place, other)


@pytest.mark.parametrize("value", PLAY_VALID)
def test_the_play_entry_follows_the_token_in_the_fragment(value: str) -> None:
    token = new_token("ml")
    assert sign_in_link(SITE, token, value) == f"{SITE}/sign-in#{token}&return={value}"


@pytest.mark.parametrize("value", PLAY_INVALID)
def test_a_link_is_never_made_with_a_wrong_play_entry(value: str) -> None:
    with pytest.raises(ValueError, match="not a return entry"):
        sign_in_link(SITE, new_token("ml"), value)
