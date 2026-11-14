"""What crosses the live WebSocket, as pure rules (live_wire_policy.py; ADR 0005, section 4):
what counts as a message, and that every message the server builds passes its schema."""

from __future__ import annotations

import pytest

from player_backend import live_wire_policy as wire
from tests.livehelp import validator


@pytest.mark.parametrize(
    "text",
    [
        "",
        "not json",
        "[]",
        '"hello"',
        "1",
        "null",
        '{"v": NaN}',
        '{"v": Infinity}',
        '{"v": -Infinity}',
        '{"v": 1.0, "type": "end"}',
        '{"v": 1e0, "type": "end"}',
        '{"v": 1, "type": "end", "type": "end"}',
        "[" * 100_000,
    ],
)
def test_what_is_not_a_message(text: str) -> None:
    assert wire.decode(text) is None


def test_a_message_is_one_json_object() -> None:
    assert wire.decode('{"v":1,"type":"end"}') == {"v": 1, "type": "end"}
    assert wire.encode({"v": 1, "type": "end"}) == '{"v":1,"type":"end"}'


def test_size_counts_utf8_bytes() -> None:
    assert wire.size("aé") == 3
    assert wire.size("\U0001f6b2") == 4


def test_the_close_codes() -> None:
    assert (wire.HELLO_REFUSED, wire.ENDED, wire.REPLACED) == (4401, 4403, 4409)
    assert (wire.TOO_BIG, wire.TOO_MANY) == (1009, 1008)


@pytest.mark.parametrize(
    ("schema", "message"),
    [
        ("welcome.schema.json", wire.welcome_host()),
        ("welcome.schema.json", wire.welcome_controller(1, True)),
        ("welcome.schema.json", wire.welcome_controller(2, False)),
        ("host-status.schema.json", wire.host_status(True)),
        ("host-status.schema.json", wire.host_status(False)),
        ("controller-joined.schema.json", wire.controller_joined(1, "code")),
        ("controller-joined.schema.json", wire.controller_joined(2, "sign_in")),
        ("controller-left.schema.json", wire.controller_left(2, "code", "disconnected")),
        ("controller-left.schema.json", wire.controller_left(1, "sign_in", "session_ended")),
        ("controller-left.schema.json", wire.controller_left(2, "sign_in", "dropped")),
        ("controller-left.schema.json", wire.controller_free(1)),
        ("controller-left.schema.json", wire.controller_free(2)),
        ("ended.schema.json", wire.ended("host_ended")),
        ("ended.schema.json", wire.ended("revoked")),
        ("ended.schema.json", wire.ended("expired")),
        ("ended.schema.json", wire.ended("dropped")),
    ],
)
def test_what_the_server_builds_passes_its_schema(schema: str, message: wire.Message) -> None:
    assert validator(schema).is_valid(message)  # pyright: ignore[reportUnknownMemberType, reportArgumentType]
