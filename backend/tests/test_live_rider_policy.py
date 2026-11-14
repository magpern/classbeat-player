"""The riders' pure rules (live_rider_policy.py; ADR 0007, sections 2 and 3; ADR 0002, section
8): the nickname, the rider id, the places and the 5-minute drop."""

from __future__ import annotations

import pytest

from player_backend.live_rider_policy import (
    JOIN_CODES_PER_HOUR,
    JOINS_PER_MINUTE,
    RIDER_AWAY_LIMIT,
    RIDERS_CONNECTED_MAX,
    clean_nickname,
    gone,
    has_place,
    rider_id,
)


def test_the_limits_are_the_adrs() -> None:
    assert RIDERS_CONNECTED_MAX == 60
    assert RIDER_AWAY_LIMIT == 300.0
    assert JOINS_PER_MINUTE == 120
    assert JOIN_CODES_PER_HOUR == 10


@pytest.mark.parametrize(
    ("raw", "kept"),
    [
        ("Sam", "Sam"),
        ("Åsa 🚴", "Åsa 🚴"),
        ("a" * 24, "a" * 24),
        ("ü" * 24, "ü" * 24),  # 24 code points, 48 bytes
        ("🚴" * 24, "🚴" * 24),  # 24 code points outside the BMP
        ("Sa\x00m", "Sam"),  # Cc
        ("Sam\n\r\t", "Sam"),
        ("\x1b[31mSam", "[31mSam"),  # the escape goes, the text stays text
        ("Sam\x7f\x85", "Sam"),  # DEL, NEL
        ("‮Sam‬", "Sam"),  # Cf: a bidirectional override
        ("S​am", "Sam"),  # Cf: a zero-width space
        ("Sam  ", "Sam"),  # Zl, Zp
        ("Sam\ud800", "Sam"),  # Cs: a lone surrogate (JSON can carry one)
        ("Sa\ufffem", "Sam"),  # Cn: a noncharacter
        ("Sam\ufdd0\U0010ffff", "Sam"),  # Cn: noncharacters, in the BMP and the last plane
        ("Sam\U000e0080", "Sam"),  # Cn: an unassigned code point
        ("\ue000Sam", "Sam"),  # Co: private use, in the BMP
        ("Sam\U000f0000\U00100000", "Sam"),  # Co: the private use planes
        ("  Sam  ", "Sam"),
        ("Sam Lee", "Sam Lee"),
        ("a" * 24 + "\x00", "a" * 24),  # 25 sent, 24 left
    ],
)
def test_a_nickname_loses_its_control_characters(raw: str, kept: str) -> None:
    assert clean_nickname(raw) == kept


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "\x00\x01",
        "‮",
        "\n",
        "\ufffe\ue000",
        " \U000f0000 ",
        "a" * 25,
        "🚴" * 25,
        None,
        7,
        ["Sam"],
    ],
)
def test_no_nickname(raw: object) -> None:
    assert clean_nickname(raw) is None


def test_a_rider_id_is_8_bytes_in_base64url_without_padding() -> None:
    assert rider_id(bytes(8)) == "AAAAAAAAAAA"
    assert rider_id(b"\xff" * 8) == "__________8"
    for raw in (b"", bytes(7), bytes(9)):
        with pytest.raises(ValueError):
            rider_id(raw)


@pytest.mark.parametrize(
    ("connected", "already", "placed"),
    [
        (0, False, True),
        (59, False, True),
        (60, False, False),
        (60, True, True),  # its new connection replaces its old one: no new place
        (61, False, False),
    ],
)
def test_places_count_tokens_connected(connected: int, already: bool, placed: bool) -> None:
    assert has_place(connected, already) is placed


@pytest.mark.parametrize(
    ("connections", "away", "dropped"),
    [
        (0, 299.999, False),
        (0, 300.0, True),
        (0, 1000.0, True),
        (1, 1000.0, False),
        (2, 1000.0, False),
    ],
)
def test_a_token_without_a_connection_for_5_minutes_is_dropped(
    connections: int, away: float, dropped: bool
) -> None:
    assert gone(connections, 100.0, 100.0 + away) is dropped
