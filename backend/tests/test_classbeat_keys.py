"""classbeat's key set, fetched and cached (ADR 0010, section 3; #481). A fake fetch and clock."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import pytest

from player_backend.classbeat_keys import (
    KEEP_FOR,
    REFETCH_EVERY,
    KeySet,
    KeySetError,
    parse_key_set,
)


@dataclass
class Fetch:
    kids: list[str] = field(default_factory=lambda: ["a"])
    fails: bool = False
    calls: int = 0

    def __call__(self) -> bytes:
        self.calls += 1
        if self.fails:
            raise OSError("down")
        return json.dumps({"keys": [{"kid": kid, "kty": "EC"} for kid in self.kids]}).encode()


@dataclass
class Clock:
    now: float = 1000.0

    def __call__(self) -> float:
        return self.now


def _kids(keys: KeySet, kid: str) -> list[object]:
    return [key.get("kid") for key in keys.keys_for(kid)]


def test_the_keys_are_fetched_at_start_and_then_served_from_the_cache() -> None:
    fetch, clock = Fetch(), Clock()
    keys = KeySet(fetch, clock)
    assert keys.refresh() is True
    clock.now += KEEP_FOR - 1
    assert _kids(keys, "a") == ["a"]
    assert fetch.calls == 1


def test_an_unknown_kid_fetches_again_at_most_once_every_five_minutes() -> None:
    fetch, clock = Fetch(), Clock()
    keys = KeySet(fetch, clock)
    keys.refresh()
    clock.now += REFETCH_EVERY - 1
    assert _kids(keys, "b") == ["a"]
    assert fetch.calls == 1
    clock.now += 1
    fetch.kids = ["a", "b"]
    assert _kids(keys, "b") == ["a", "b"]
    assert fetch.calls == 2
    assert _kids(keys, "c") == ["a", "b"]
    assert fetch.calls == 2


def test_a_failed_fetch_keeps_the_cache_until_it_is_a_day_old() -> None:
    fetch, clock = Fetch(), Clock()
    keys = KeySet(fetch, clock)
    keys.refresh()
    fetch.fails = True
    clock.now += KEEP_FOR - 1
    assert _kids(keys, "b") == ["a"]
    clock.now += 1
    assert keys.keys_for("a") == ()
    fetch.fails = False
    assert keys.keys_for("a") == ()  # within 5 minutes of the failed try
    clock.now += REFETCH_EVERY
    assert _kids(keys, "a") == ["a"]


def test_a_failed_first_fetch_holds_no_key() -> None:
    fetch, clock = Fetch(fails=True), Clock()
    keys = KeySet(fetch, clock)
    assert keys.refresh() is False
    assert keys.keys_for("a") == ()


@pytest.mark.parametrize(
    "body", [b"", b"not json", b"[]", b'{"keys": {}}', b'{"other": []}', b"\xff"]
)
def test_a_document_that_is_not_a_key_set_is_refused(body: bytes) -> None:
    with pytest.raises(KeySetError):
        parse_key_set(body)


def test_only_objects_are_keys() -> None:
    assert parse_key_set(b'{"keys": [1, "x", {"kid": "a"}]}') == ({"kid": "a"},)
