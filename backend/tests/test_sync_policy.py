"""The pure rules of class sync (sync_policy.py): the ranges, resync and one page."""

from __future__ import annotations

import pytest

from player_backend.sync_policy import (
    BASE_END,
    BASE_MIN,
    CURSOR_MAX,
    PAGE_DEFAULT,
    PAGE_MAX,
    base_of,
    is_page_request,
    needs_resync,
    page_of,
    page_request,
)


def test_the_ranges() -> None:
    assert (PAGE_DEFAULT, PAGE_MAX, CURSOR_MAX) == (100, 500, 2**63 - 1)
    assert is_page_request(0, 1) and is_page_request(CURSOR_MAX, PAGE_MAX)
    for after, limit in ((-1, 1), (CURSOR_MAX + 1, 1), (0, 0), (0, PAGE_MAX + 1), (0, -1)):
        assert not is_page_request(after, limit)


def test_a_page_request_from_the_querys_raw_text() -> None:
    assert page_request(None, None) == (0, PAGE_DEFAULT)
    assert page_request("0", "1") == (0, 1)
    assert page_request("007", "500") == (7, 500)
    assert page_request(str(CURSOR_MAX), None) == (CURSOR_MAX, PAGE_DEFAULT)
    for after, limit in (
        (str(CURSOR_MAX + 1), None),
        ("9" * 20, None),
        ("9" * 4000, None),
        ("", None),
        ("-1", None),
        ("+1", None),
        (" 1", None),
        ("1 ", None),
        ("1\n", None),
        ("1_0", None),
        ("٣", None),  # an Arabic-Indic digit: `int` would take it
        ("1.0", None),
        ("0x1", None),
        (None, "0"),
        (None, "501"),
        (None, ""),
        (None, "1.5"),
    ):
        assert page_request(after, limit) is None, (after, limit)


def test_only_0_or_a_place_from_the_base_to_the_current_one_needs_no_resync() -> None:
    # An order from before bases: base 0.
    assert not needs_resync(0, 0, 0)
    assert not needs_resync(4, 0, 5) and not needs_resync(5, 0, 5)
    assert needs_resync(6, 0, 5) and needs_resync(1, 0, 0)
    # An order with its own base: 0 and the places from the base up to the current one.
    base = BASE_MIN + 7
    assert not needs_resync(0, base, base + 3)
    for own in (base, base + 1, base + 3):
        assert not needs_resync(own, base, base + 3)
    for foreign in (1, 3, base - 1, base + 4, CURSOR_MAX):
        assert needs_resync(foreign, base, base + 3)


def test_a_base_keeps_every_place_a_safe_integer_for_javascript() -> None:
    assert base_of(0) == BASE_MIN == 2**32
    assert base_of(BASE_END - BASE_MIN - 1) == BASE_END - 1
    # 2^52 publications after the highest base, a place is still below 2^53.
    assert BASE_END + 2**52 <= 2**53
    for draw in (-1, BASE_END - BASE_MIN):
        with pytest.raises(ValueError):
            base_of(draw)


def test_a_page_keeps_the_limit_and_says_whether_more_follow() -> None:
    page = page_of(["a", "b", "c"], [3, 7, 9], 1, 2)
    assert (list(page.changes), page.cursor, page.more) == (["a", "b"], 7, True)
    whole = page_of(["a", "b"], [3, 7], 1, 2)
    assert (list(whole.changes), whole.cursor, whole.more) == (["a", "b"], 7, False)


def test_an_empty_page_keeps_the_cursor_it_was_asked_for() -> None:
    page = page_of(list[str](), [], 5, PAGE_DEFAULT)
    assert (list(page.changes), page.cursor, page.more) == ([], 5, False)


def test_a_page_refuses_what_its_caller_must_never_pass() -> None:
    with pytest.raises(ValueError):
        page_of(["a"], [], 0, 1)
    with pytest.raises(ValueError):
        page_of(["a"], [1], 0, PAGE_MAX + 1)
    with pytest.raises(ValueError):
        page_of(["a"], [1], -1, 1)
