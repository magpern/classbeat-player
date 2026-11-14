"""The replay of both controller places after a host `welcome` (live_place_policy.py; ADR 0005
section 10, amended 2026-11-14): one message per place, in slot order, each valid by the
contract's `controller_left` or `controller_joined` schema."""

from __future__ import annotations

from typing import Any

import pytest

from player_backend.live_place_policy import SLOTS, replay
from tests.livehelp import validator

FREE_1 = {"v": 1, "type": "controller_left", "slot": 1, "reason": "free"}
FREE_2 = {"v": 1, "type": "controller_left", "slot": 2, "reason": "free"}


def _joined(slot: int, via: str) -> dict[str, object]:
    return {"v": 1, "type": "controller_joined", "slot": slot, "via": via}


def _away(slot: int, via: str) -> dict[str, object]:
    return {"v": 1, "type": "controller_left", "slot": slot, "via": via, "reason": "disconnected"}


@pytest.mark.parametrize(
    ("held", "connected", "expected"),
    [
        ({}, (), [FREE_1, FREE_2]),
        ({1: "code"}, (1,), [_joined(1, "code"), FREE_2]),
        ({1: "code"}, (), [_away(1, "code"), FREE_2]),
        ({2: "sign_in"}, (2,), [FREE_1, _joined(2, "sign_in")]),
        ({2: "sign_in"}, (), [FREE_1, _away(2, "sign_in")]),
        ({1: "sign_in", 2: "code"}, (1, 2), [_joined(1, "sign_in"), _joined(2, "code")]),
        ({1: "sign_in", 2: "code"}, (2,), [_away(1, "sign_in"), _joined(2, "code")]),
        ({2: "code", 1: "sign_in"}, (), [_away(1, "sign_in"), _away(2, "code")]),
        # A connection whose token no longer holds its place: the registry decides, `free`.
        ({}, (1, 2), [FREE_1, FREE_2]),
        ({2: "code"}, (1,), [FREE_1, _away(2, "code")]),
    ],
)
def test_the_replay_names_both_places_in_slot_order(
    held: dict[int, Any], connected: tuple[int, ...], expected: list[dict[str, object]]
) -> None:
    out = replay(held, connected)
    assert out == expected
    assert [m["slot"] for m in out] == list(SLOTS) == [1, 2]
    for message in out:
        name = f"{str(message['type']).replace('_', '-')}.schema.json"
        assert validator(name).is_valid(message), message  # pyright: ignore[reportUnknownMemberType, reportArgumentType]


def test_free_has_no_via_and_every_other_reason_has_one() -> None:
    for message in replay({1: "code"}, ()) + replay({}, ()):
        assert ("via" in message) == (message["reason"] != "free")
    bad = dict(FREE_1, via="code")
    assert not validator("controller-left.schema.json").is_valid(bad)  # pyright: ignore[reportUnknownMemberType]
