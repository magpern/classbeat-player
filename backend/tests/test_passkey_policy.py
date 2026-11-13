"""The pure passkey rules (passkey_policy.py): the relying party, the challenge a client's data
names, credential ids, the limits' keys and the name."""

from __future__ import annotations

import base64
import hashlib
import json
import uuid

import pytest

from player_backend.passkey_policy import (
    challenge_hash,
    challenge_of,
    clean_name,
    credential_id_of,
    failed_limit_key,
    failed_lock_key,
    from_base64url,
    registration_starts_key,
    rp_id_of,
    sign_in_starts_key,
)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _client_data(**fields: object) -> str:
    return _b64(json.dumps(fields).encode())


CHALLENGE = bytes(range(32))


@pytest.mark.parametrize(
    ("origin", "rp_id"),
    [
        ("https://player.test", "player.test"),
        ("https://player.test:8443", "player.test"),
        ("http://127.0.0.1:8080", "127.0.0.1"),
        ("https://Player.Test/", "player.test"),
    ],
)
def test_the_rp_id_is_the_sites_host_name(origin: str, rp_id: str) -> None:
    assert rp_id_of(origin) == rp_id


def test_an_origin_without_a_host_has_no_rp_id() -> None:
    with pytest.raises(ValueError):
        rp_id_of("not a url")


def test_a_challenge_is_stored_as_its_sha256() -> None:
    assert challenge_hash(CHALLENGE) == hashlib.sha256(CHALLENGE).digest()


def test_the_limit_key_is_per_address_and_its_own() -> None:
    one, two = b"a" * 32, b"b" * 32
    assert failed_limit_key(one) != failed_limit_key(two)
    assert failed_limit_key(one) == hashlib.sha256(b"passkey.failed:" + one).digest()
    assert failed_limit_key(one) != hashlib.sha256(one).digest()


def test_the_start_keys_are_their_own() -> None:
    address = b"a" * 32
    account = uuid.UUID(int=1)
    assert sign_in_starts_key(address) not in (failed_limit_key(address), address)
    assert sign_in_starts_key(address) != sign_in_starts_key(b"b" * 32)
    assert len(sign_in_starts_key(address)) == 32
    assert registration_starts_key(account) != registration_starts_key(uuid.UUID(int=2))
    assert registration_starts_key(account) != hashlib.sha256(account.bytes).digest()
    assert len(registration_starts_key(account)) == 32


@pytest.mark.parametrize("head", [b"\x00\x00\x00\x00", b"\x7f\xff\xff\xff", b"\x80\x00\x00\x00"])
def test_the_lock_key_is_a_signed_32_bit_integer_of_the_counters_key(head: bytes) -> None:
    found = failed_lock_key(head + b"z" * 28)
    assert -(2**31) <= found < 2**31
    assert found == int.from_bytes(head, "big", signed=True)


@pytest.mark.parametrize(
    ("text", "found"),
    [
        (_b64(b"\x00\xff\xfe"), b"\x00\xff\xfe"),
        (base64.urlsafe_b64encode(b"\x00\xff\xfe").decode(), b"\x00\xff\xfe"),
        ("", b""),
        ("a", None),
        ("ä", None),
        ("!!!!", None),
        (5, None),
        (None, None),
    ],
)
def test_base64url(text: object, found: bytes | None) -> None:
    assert from_base64url(text) == found


@pytest.mark.parametrize(
    ("raw", "found"),
    [
        (_b64(b"x" * 16), b"x" * 16),
        (_b64(b"x" * 1023), b"x" * 1023),
        (_b64(b"x" * 15), None),
        (_b64(b"x" * 1024), None),
        ("#", None),
        (None, None),
    ],
)
def test_a_credential_id_is_one_the_table_can_hold(raw: object, found: bytes | None) -> None:
    assert credential_id_of(raw) == found


def test_the_challenge_a_client_names() -> None:
    named = _b64(CHALLENGE)
    assert challenge_of(_client_data(type="webauthn.get", challenge=named)) == CHALLENGE
    assert challenge_of(_client_data(challenge=named, crossOrigin=False)) == CHALLENGE


@pytest.mark.parametrize(
    "client_data",
    [
        _client_data(challenge=_b64(CHALLENGE), crossOrigin=True),
        _client_data(challenge=_b64(CHALLENGE), crossOrigin="false"),
        _client_data(challenge=_b64(CHALLENGE[:31])),
        _client_data(challenge=_b64(CHALLENGE + b"x")),
        _client_data(challenge=5),
        _client_data(origin="https://player.test"),
        _b64(b"[1, 2]"),
        _b64(b"not json"),
        "!!",
        None,
    ],
)
def test_client_data_that_names_none_of_our_challenges(client_data: object) -> None:
    assert challenge_of(client_data) is None


@pytest.mark.parametrize(
    ("raw", "name"),
    [
        ("  Laptop ", "Laptop"),
        ("My‮ phone", "My phone"),
        ("x" * 40, "x" * 40),
        ("x" * 41, None),
        ("", None),
        ("   ", None),
        (5, None),
    ],
)
def test_a_passkeys_name(raw: object, name: str | None) -> None:
    assert clean_name(raw) == name
