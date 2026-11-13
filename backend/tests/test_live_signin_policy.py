"""The pure limits of a controller by sign-in (live_signin_policy.py; ADR 0005, section 10).

- calls without a session: 60 per address a minute, then refused until the minute ends; other
  addresses are not held back;
- unknown join codes: 60 per account a minute, then the account is refused until the minute
  ends; other accounts are not held back;
- the two counts are separate: a refused address does not refuse an account and the reverse;
- the window is fixed from the key's first count and resets after a minute;
- keys whose minute is over are forgotten once many are held.
"""

from __future__ import annotations

from player_backend.live_signin_policy import (
    SIGNED_OUT_PER_MINUTE,
    UNKNOWN_PER_MINUTE,
    MinuteCount,
    SignInLimits,
)

ADDRESS, OTHER_ADDRESS = b"a" * 32, b"b" * 32
ACCOUNT, OTHER_ACCOUNT = b"c" * 16, b"d" * 16


def test_the_limits_are_sixty_a_minute() -> None:
    assert SIGNED_OUT_PER_MINUTE == 60 and UNKNOWN_PER_MINUTE == 60


def test_calls_without_a_session_are_refused_past_sixty_per_address() -> None:
    limits = SignInLimits()
    for i in range(SIGNED_OUT_PER_MINUTE):
        assert not limits.signed_out_refused(ADDRESS, float(i) / 2)
        limits.signed_out(ADDRESS, float(i) / 2)
    assert limits.signed_out_refused(ADDRESS, 59.9)
    assert not limits.signed_out_refused(OTHER_ADDRESS, 59.9)
    # The address count refuses no account.
    assert not limits.account_refused(ACCOUNT, 59.9)


def test_unknown_codes_refuse_the_account_past_sixty() -> None:
    limits = SignInLimits()
    for _ in range(UNKNOWN_PER_MINUTE - 1):
        limits.unknown_code(ACCOUNT, 10.0)
    assert not limits.account_refused(ACCOUNT, 10.0)
    limits.unknown_code(ACCOUNT, 10.0)
    assert limits.account_refused(ACCOUNT, 10.0)
    assert not limits.account_refused(OTHER_ACCOUNT, 10.0)
    # The account count refuses no address.
    assert not limits.signed_out_refused(ADDRESS, 10.0)


def test_the_window_resets_a_minute_after_the_first_count() -> None:
    limits = SignInLimits()
    limits.unknown_code(ACCOUNT, 100.0)
    for _ in range(UNKNOWN_PER_MINUTE - 1):
        limits.unknown_code(ACCOUNT, 130.0)
    assert limits.account_refused(ACCOUNT, 159.9)
    assert not limits.account_refused(ACCOUNT, 160.0)  # fixed from the first count
    limits.unknown_code(ACCOUNT, 160.0)
    assert not limits.account_refused(ACCOUNT, 160.0)  # a new minute starts at 1
    for _ in range(SIGNED_OUT_PER_MINUTE):
        limits.signed_out(ADDRESS, 0.0)
    assert limits.signed_out_refused(ADDRESS, 59.0)
    assert not limits.signed_out_refused(ADDRESS, 60.0)


def test_a_count_forgets_keys_whose_minute_is_over() -> None:
    count = MinuteCount(2)
    for i in range(5000):
        count.count(i.to_bytes(4, "big"), 0.0)
    assert count.held() == 5000
    count.count(b"new!", 61.0)
    assert count.held() == 1
