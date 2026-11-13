"""The control code's pure rules (live_code_policy.py; ADR 0002, sections 8 and 10; ADR 0005,
section 3): single use, 2 minutes, 5 wrong tries, `full` neither used up nor counted, a new code
replaces the current one, 30 an hour, `drop` ends it silently; and the per-address count of
unknown sessions."""

from __future__ import annotations

import pytest

from player_backend.live_code_policy import (
    CODE_LIFETIME,
    CODES_PER_HOUR,
    UNKNOWN_PER_MINUTE,
    WRONG_TRIES,
    ControlCode,
    Try,
    UnknownSessions,
)

RIGHT = b"r" * 32
WRONG = b"w" * 32


def _made(now: float = 0.0) -> ControlCode:
    code = ControlCode()
    assert code.make(RIGHT, now) == (True, None)
    return code


def test_the_limits_are_the_adrs() -> None:
    assert (CODE_LIFETIME, WRONG_TRIES, CODES_PER_HOUR, UNKNOWN_PER_MINUTE) == (120.0, 5, 30, 60)


def test_a_right_code_works_once() -> None:
    code = _made()
    assert code.tried(RIGHT, True, 1.0) == Try("right", "used")
    assert code.tried(RIGHT, True, 2.0) == Try("wrong", None)


def test_no_code_made_grants_nothing() -> None:
    assert ControlCode().tried(RIGHT, True, 0.0) == Try("wrong", None)


@pytest.mark.parametrize(("after", "works"), [(119.999, True), (120.0, False), (500.0, False)])
def test_a_code_works_for_two_minutes(after: float, works: bool) -> None:
    code = _made(10.0)
    expected = Try("right", "used") if works else Try("wrong", "expired")
    assert code.tried(RIGHT, True, 10.0 + after) == expected


def test_expiry_is_told_once() -> None:
    code = _made()
    assert code.expire(119.0) is False
    assert code.expire(120.0) is True
    assert code.expire(121.0) is False
    assert code.tried(RIGHT, True, 122.0) == Try("wrong", None)


def test_five_wrong_tries_cancel_the_code() -> None:
    code = _made()
    for _ in range(WRONG_TRIES - 1):
        assert code.tried(WRONG, True, 1.0) == Try("wrong", None)
    assert code.tried(WRONG, True, 1.0) == Try("wrong", "wrong_tries")
    assert code.tried(RIGHT, True, 1.0) == Try("wrong", None)


def test_four_wrong_tries_leave_the_right_code_working() -> None:
    code = _made()
    for _ in range(WRONG_TRIES - 1):
        code.tried(WRONG, True, 1.0)
    assert code.tried(RIGHT, True, 1.0) == Try("right", "used")


def test_a_right_code_while_both_places_are_held_is_full_and_neither_used_nor_counted() -> None:
    code = _made()
    for _ in range(WRONG_TRIES * 3):
        assert code.tried(RIGHT, False, 1.0) == Try("full", None)
    for _ in range(WRONG_TRIES - 1):
        code.tried(WRONG, False, 1.0)  # a wrong code is counted, whatever the places
    assert code.tried(RIGHT, True, 1.0) == Try("right", "used")


def test_a_wrong_code_while_full_is_counted() -> None:
    code = _made()
    for _ in range(WRONG_TRIES - 1):
        code.tried(WRONG, False, 1.0)
    assert code.tried(WRONG, False, 1.0) == Try("wrong", "wrong_tries")


def test_a_new_code_replaces_the_current_one_and_starts_its_count_again() -> None:
    code = _made()
    for _ in range(WRONG_TRIES - 1):
        code.tried(WRONG, True, 1.0)
    newer = b"n" * 32
    assert code.make(newer, 2.0) == (True, "replaced")
    assert code.tried(RIGHT, True, 3.0) == Try("wrong", None)  # the old one: counted (1)
    for _ in range(WRONG_TRIES - 2):
        code.tried(WRONG, True, 3.0)
    assert code.tried(newer, True, 3.0) == Try("right", "used")


def test_a_code_made_after_the_earlier_ran_out_says_so() -> None:
    code = _made()
    assert code.make(WRONG, CODE_LIFETIME + 1.0) == (True, "expired")


def test_a_code_made_after_the_earlier_was_used_cancels_nothing() -> None:
    code = _made()
    code.tried(RIGHT, True, 1.0)
    assert code.make(WRONG, 2.0) == (True, None)


def test_thirty_codes_an_hour() -> None:
    code = ControlCode()
    for n in range(CODES_PER_HOUR):
        assert code.make(bytes([n]) * 32, float(n))[0] is True
    assert code.make(RIGHT, 100.0) == (False, None)
    # The current code stays as it was.
    assert code.tried(bytes([CODES_PER_HOUR - 1]) * 32, True, 101.0) == Try("right", "used")
    assert code.make(RIGHT, 3600.0)[0] is True  # the first one is an hour old


def test_drop_ends_the_code() -> None:
    code = _made()
    code.end()
    assert code.tried(RIGHT, True, 1.0) == Try("wrong", None)
    assert code.expire(500.0) is False  # nothing is left to be told


def test_what_is_left_of_a_code() -> None:
    code = _made(10.0)
    assert code.expires_in_ms(10.0) == 120000
    assert code.expires_in_ms(70.5) == 59500
    assert code.expires_in_ms(500.0) == 1


def test_sixty_unknown_sessions_a_minute_then_the_address_waits_for_its_minute() -> None:
    gate = UnknownSessions()
    me, other = b"a" * 32, b"b" * 32
    for n in range(UNKNOWN_PER_MINUTE):
        assert gate.refused_for(me, 100.0 + n * 0.5) is None
        gate.count(me, 100.0 + n * 0.5)
    assert gate.refused_for(me, 130.0) == 30
    assert gate.refused_for(me, 159.5) == 1
    assert gate.refused_for(other, 130.0) is None
    assert gate.refused_for(me, 160.0) is None
    gate.count(me, 160.0)  # a new minute starts with this one
    assert gate.refused_for(me, 160.0) is None


def test_the_unknown_counts_forget_old_addresses() -> None:
    gate = UnknownSessions()
    for n in range(5000):
        gate.count(n.to_bytes(4), 0.0)
    gate.count(b"late", 61.0)
    assert gate.held() == 1
