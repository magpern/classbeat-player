"""The class library's pure rules (library_policy.py): the page a request names, and what the
list shows of a class and of a marker."""

from __future__ import annotations

import pytest

from player_backend.library_policy import (
    PAGE_DEFAULT,
    PAGE_MAX,
    PLACE_MAX,
    PageRequest,
    length_of,
    page_request,
    title_of,
)


@pytest.mark.parametrize(
    ("before", "limit", "expected"),
    [
        (None, None, PageRequest(None, PAGE_DEFAULT)),
        ("0", "1", PageRequest(0, 1)),
        ("17", str(PAGE_MAX), PageRequest(17, PAGE_MAX)),
        (str(PLACE_MAX), None, PageRequest(PLACE_MAX, PAGE_DEFAULT)),
        ("007", "05", PageRequest(7, 5)),
    ],
)
def test_a_page_in_range_is_read(
    before: str | None, limit: str | None, expected: PageRequest
) -> None:
    assert page_request(before, limit) == expected


@pytest.mark.parametrize(
    ("before", "limit"),
    [
        (None, "0"),
        (None, str(PAGE_MAX + 1)),
        (None, ""),
        ("", None),
        (str(PLACE_MAX + 1), None),
        ("9" * 20, None),
        ("-1", None),
        ("+1", None),
        (" 1", None),
        ("1_0", None),
        ("1.0", None),
        ("１", None),  # a fullwidth digit, which `int` would take
        ("١", None),  # an Arabic-Indic digit
        (None, "1e2"),
    ],
)
def test_anything_else_is_refused(before: str | None, limit: str | None) -> None:
    assert page_request(before, limit) is None


def test_a_marker_shows_no_title_and_no_length() -> None:
    assert title_of(True, "Hills") is None
    assert length_of(True, 2_700_000) is None


def test_a_class_shows_its_title_and_length_when_they_have_their_types() -> None:
    assert title_of(False, "Hills") == "Hills"
    assert length_of(False, 2_700_000) == 2_700_000
    for odd in (None, 5, ["Hills"], {"x": 1}):
        assert title_of(False, odd) is None
    for odd in (None, True, "2700000", 2.5):
        assert length_of(False, odd) is None
