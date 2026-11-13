"""The relay of commands as pure rules (live_relay_policy.py; ADR 0005, sections 1, 4 and 5).

- beyond the rate the server answers `rate` itself; with the host away, `host_away`; neither
  forwards anything;
- the forwarded command is the phone's fields with the server's `slot`, nothing else;
- `ack` is the host's `command_result` without its `slot`, and goes on once per forwarded id.
"""

from __future__ import annotations

import pytest
from jsonschema import Draft202012Validator

from player_backend.live_relay_policy import (
    OUTSTANDING_MAX,
    Answer,
    Forward,
    Outstanding,
    ack,
    ack_of,
    forwarded,
    on_command,
)
from tests.livehelp import command, command_id, result, validator

ACK = validator("ack.schema.json")
FORWARDED = validator("command-forwarded.schema.json")


def _valid(v: Draft202012Validator, message: object) -> None:
    assert v.is_valid(message)  # pyright: ignore[reportUnknownMemberType, reportArgumentType]


def test_beyond_the_rate_the_server_answers_rate_and_forwards_nothing() -> None:
    for host_in in (True, False):
        outcome = on_command(command(1), 1, within_rate=False, host_in=host_in)
        assert outcome == Answer(ack(command_id(1), "refused", "rate"))
        _valid(ACK, outcome.message)


def test_with_the_host_away_the_server_answers_host_away_and_forwards_nothing() -> None:
    outcome = on_command(command(1), 2, within_rate=True, host_in=False)
    assert outcome == Answer(ack(command_id(1), "refused", "host_away"))
    _valid(ACK, outcome.message)


@pytest.mark.parametrize("slot", [1, 2])
def test_a_command_goes_to_the_host_with_the_servers_slot(slot: int) -> None:
    sent = command(1, "nudge", deltaMs=-5000)
    outcome = on_command(sent, slot, within_rate=True, host_in=True)
    assert isinstance(outcome, Forward)
    assert outcome.message == {**sent, "slot": slot}
    _valid(FORWARDED, outcome.message)


def test_the_forwarded_command_takes_only_the_commands_fields() -> None:
    sent = command(1) | {"slot": 2, "extra": "x"}  # not reached: the schema refuses both
    assert forwarded(sent, 1) == {**command(1), "slot": 1}


@pytest.mark.parametrize(
    ("outcome", "reason"),
    [
        ("applied", None),
        ("duplicate", None),
        ("refused", "stale"),
        ("refused", "stale_run"),
        ("refused", "invalid"),
        ("refused", "not_allowed"),
        ("refused", "would_stop_following"),
    ],
)
def test_ack_is_the_hosts_result_without_its_slot(outcome: str, reason: str | None) -> None:
    passed = ack_of(result(2, 7, outcome, reason))
    assert passed == {
        "v": 1,
        "type": "ack",
        "id": command_id(7),
        "result": outcome,
        "reason": reason,
    }
    _valid(ACK, passed)


def test_an_id_is_answered_once_and_only_when_forwarded() -> None:
    held = Outstanding()
    assert not held.answer(command_id(1))
    held.add(command_id(1))
    held.add(command_id(1))  # a resend of the same tap
    assert len(held) == 1
    assert held.answer(command_id(1))
    assert not held.answer(command_id(1))


def test_the_oldest_outstanding_id_is_forgotten_first() -> None:
    held = Outstanding()
    for n in range(OUTSTANDING_MAX + 1):
        held.add(command_id(n))
    assert len(held) == OUTSTANDING_MAX
    assert not held.answer(command_id(0))
    assert held.answer(command_id(OUTSTANDING_MAX))
