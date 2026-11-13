"""The pure rules of class sync (sync_policy.py): the ranges, resync and one page."""

from __future__ import annotations

from uuid import UUID

import pytest

from player_backend.sync_policy import (
    CURSOR_MAX,
    PAGE_DEFAULT,
    PAGE_MAX,
    class_id_of,
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


def test_a_class_id_in_its_canonical_form_only() -> None:
    canonical = "1a2b3c4d-0000-4000-8000-00000000000f"
    assert class_id_of(canonical) == UUID(canonical)
    assert class_id_of(canonical.upper()) == UUID(canonical)
    for raw in (
        "",
        "not-an-id",
        canonical.replace("-", ""),
        "{" + canonical + "}",
        "urn:uuid:" + canonical,
        canonical + "\n",
        " " + canonical,
        canonical[:-1] + "g",
    ):
        assert class_id_of(raw) is None, raw


def test_only_a_cursor_above_the_current_one_needs_a_resync() -> None:
    assert not needs_resync(0, 0)
    assert not needs_resync(4, 5) and not needs_resync(5, 5)
    assert needs_resync(6, 5) and needs_resync(1, 0)


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
