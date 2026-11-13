"""The pure rules of pairing and the device token (ADR 0002, sections 2, 3, 6 and 10): short
codes, labels, the bearer header, the counters' keys and what a process remembers. No I/O."""

from __future__ import annotations

import hashlib
from datetime import timedelta

import pytest

from player_backend import bearer_policy, pairing_policy
from player_backend.bearer_blocks import BearerBlocks
from player_backend.bearer_policy import bearer_device_token
from player_backend.code_issue import new_code
from player_backend.code_policy import ALPHABET, code_hash, normalise_code, show_code
from player_backend.pairing_policy import clean_label, paired_mail, pairing_page, poll_refusal
from player_backend.request_policy import response_headers
from player_backend.token_issue import new_token
from player_backend.token_policy import TokenKind, is_token


def test_a_short_code_is_eight_letters_without_vowels_or_digits() -> None:
    assert ALPHABET == "BCDFGHJKLMNPQRSTVWXZ" and len(set(ALPHABET)) == 20
    codes = {new_code() for _ in range(200)}
    assert len(codes) == 200
    assert all(len(code) == 8 and set(code) <= set(ALPHABET) for code in codes)
    # Every letter is drawn: 1,600 letters from 20.
    assert set("".join(codes)) == set(ALPHABET)
    assert show_code("BCDFGHJK") == "BCDF-GHJK"


@pytest.mark.parametrize(
    "typed", ["BCDFGHJK", "bcdf-ghjk", " bcdf ghjk ", "B-C-D-F-G-H-J-K", "BCDF--GHJK"]
)
def test_input_ignores_case_spaces_and_hyphens(typed: str) -> None:
    assert normalise_code(typed) == "BCDFGHJK"


@pytest.mark.parametrize(
    "typed",
    [
        "",
        "BCDFGHJ",
        "BCDFGHJKL",
        "ABCDFGHJ",
        "BCDF1HJK",
        "BCDF_GHJK",
        "BCDF\tGHJK",
        "ВCDFGHJK",
        None,
        5,
        b"BCDFGHJK",
        "B" + " " * 40 + "CDFGHJK",
    ],
)
def test_what_is_not_a_short_code_is_refused(typed: object) -> None:
    assert normalise_code(typed) is None


def test_a_short_code_is_stored_as_its_sha256() -> None:
    assert code_hash("BCDFGHJK") == hashlib.sha256(b"BCDFGHJK").digest()


def test_the_new_token_types() -> None:
    kinds: tuple[TokenKind, ...] = ("dc", "dev")
    for kind in kinds:
        token = new_token(kind)
        assert token.startswith(f"cbp_{kind}_") and is_token(kind, token)
    assert not is_token("dev", new_token("dc")) and not is_token("dc", new_token("dev"))


@pytest.mark.parametrize(
    ("raw", "kept"),
    [
        ("Studio PC", "Studio PC"),
        ("  Studio PC \n", "Studio PC"),
        ("Stu\u0000dio‮ PC​", "Studio PC"),
        ("<b>Bike 1</b>", "<b>Bike 1</b>"),  # kept as text: it is rendered as text
        ("Cykel på övervåningen", "Cykel på övervåningen"),
        ("n" * 40, "n" * 40),
    ],
)
def test_a_label_keeps_its_text_without_control_characters(raw: str, kept: str) -> None:
    assert clean_label(raw) == kept


@pytest.mark.parametrize("raw", ["", "   ", "\u0000‮", "n" * 41, None, 5, "n" * 401])
def test_a_label_of_no_or_too_many_characters_is_refused(raw: object) -> None:
    assert clean_label(raw) is None


def test_what_the_app_is_told_matches_the_adr() -> None:
    assert (pairing_policy.EXPIRES_IN, pairing_policy.INTERVAL) == (600, 5)
    assert (pairing_policy.START_WINDOW, pairing_policy.START_MAX) == (timedelta(hours=1), 10)
    assert pairing_page("https://player.test") == "https://player.test/pair"
    for state in ("authorization_pending", "slow_down", "access_denied", "expired_token"):
        assert poll_refusal(state) == state
    for state in ("ok", "approved", None, 5, ""):
        assert poll_refusal(state) == "expired_token"


def test_the_mail_about_a_new_device_holds_no_token_and_no_code() -> None:
    mail = paired_mail("https://player.test", "rider@example.test")
    assert mail.to == "rider@example.test" and "revoke" in mail.body
    assert "cbp_" not in mail.body and "#" not in mail.body and "?" not in mail.body


def test_the_bearer_limits_match_the_adr() -> None:
    five = timedelta(minutes=5)
    assert (bearer_policy.SAME_TOKEN_WINDOW, bearer_policy.SAME_TOKEN_MAX) == (five, 20)
    assert (bearer_policy.UNKNOWN_WINDOW, bearer_policy.UNKNOWN_MAX) == (five, 200)
    assert (bearer_policy.REQUEST_WINDOW, bearer_policy.REQUEST_MAX) == (timedelta(minutes=1), 60)
    assert bearer_policy.COUNTED_PER_TOKEN == {"revoked", "unknown"}
    assert bearer_policy.REFUSAL_CODES == {
        "revoked": "token_revoked",
        "unknown": "token_unknown",
        "expired": "token_expired",
    }


def test_only_a_device_token_in_a_bearer_header_is_taken() -> None:
    token = new_token("dev")
    assert bearer_device_token("Bearer " + token) == token
    assert bearer_device_token("bearer " + token) == token
    for value in (
        None,
        "",
        token,
        "Basic " + token,
        "Bearer",
        "Bearer  " + token,
        "Bearer " + token + " ",
        "Bearer " + token + "A",
        "Bearer " + new_token("ses"),
        "Bearer " + new_token("dc"),
        "Token " + token,
    ):
        assert bearer_device_token(value) is None


def test_the_counters_keys_are_hashes_that_differ_by_what_they_count() -> None:
    token, other, address = b"t" * 32, b"u" * 32, b"a" * 32
    keys = {
        bearer_policy.same_token_key(token, address),
        bearer_policy.same_token_key(other, address),
        bearer_policy.same_token_key(token, other),
        bearer_policy.unknown_tokens_key(address),
        bearer_policy.requests_key(token),
        bearer_policy.requests_key(address),
        pairing_policy.start_limit_key(address),
    }
    assert len(keys) == 7 and all(len(key) == 32 for key in keys)
    assert not any(token in key or address in key for key in keys)


def test_the_apis_that_carry_tokens_are_never_stored() -> None:
    for path in ("/api/pairing/start", "/api/pairing/token", "/api/player/device"):
        assert response_headers(path)["Cache-Control"] == "no-store"
    assert "Cache-Control" not in response_headers("/api/pairingx")


def test_a_block_is_remembered_until_it_ends() -> None:
    blocks = BearerBlocks()
    key, other = b"k" * 32, b"o" * 32
    assert blocks.seconds_left(key, 1000.0) is None
    blocks.block(key, until=1300.0, now=1000.0)
    assert blocks.seconds_left(key, 1000.0) == 300
    assert blocks.seconds_left(key, 1299.5) == 1
    assert blocks.seconds_left(other, 1000.0) is None
    # A later block never shortens an earlier one.
    blocks.block(key, until=1100.0, now=1000.0)
    assert blocks.seconds_left(key, 1200.0) == 100
    assert blocks.seconds_left(key, 1300.0) is None and len(blocks) == 0


def test_the_memory_of_blocks_is_bounded() -> None:
    blocks = BearerBlocks(capacity=3)
    for number in range(3):
        blocks.block(bytes([number]), until=100.0 + number, now=0.0)
    # Full: an ended entry goes first.
    blocks.block(b"new", until=500.0, now=100.5)
    assert len(blocks) == 3 and blocks.seconds_left(bytes([0]), 100.5) is None
    assert blocks.seconds_left(bytes([1]), 100.5) is not None
    # Full with nothing ended: the one that ends soonest goes.
    blocks.block(b"newer", until=600.0, now=100.5)
    assert len(blocks) == 3 and blocks.seconds_left(bytes([1]), 100.5) is None
    assert blocks.seconds_left(b"new", 100.5) is not None
    assert blocks.seconds_left(b"newer", 100.5) is not None
