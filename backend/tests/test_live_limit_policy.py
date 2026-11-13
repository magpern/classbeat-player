"""The live WebSocket's limits as pure rules (live_limit_policy.py; ADR 0002, sections 8 and 10;
ADR 0005, section 5): the sliding window, the per-address gate and the size limits."""

from __future__ import annotations

from player_backend.live_limit_policy import (
    COMMANDS_PER_SECOND,
    CONNECTIONS_PER_MINUTE,
    HELLO_MAX_BYTES,
    HELLO_WITHIN,
    MESSAGE_MAX_BYTES,
    MESSAGES_PER_SECOND,
    WAITING_FOR_HELLO,
    AddressGate,
    Window,
    commands_window,
    messages_window,
)
from player_backend.live_limit_policy import too_big as too_big_


def test_the_numbers_are_adr_0002s_and_adr_0005s() -> None:
    assert (HELLO_WITHIN, HELLO_MAX_BYTES, MESSAGE_MAX_BYTES) == (5.0, 1024, 16 * 1024)
    assert (MESSAGES_PER_SECOND, COMMANDS_PER_SECOND) == (10, 2)
    assert (CONNECTIONS_PER_MINUTE, WAITING_FOR_HELLO) == (300, 100)


def test_a_window_holds_its_limit_in_any_span() -> None:
    window = Window(2, 1.0)
    assert window.take(10.0) and window.take(10.5)
    assert not window.take(10.99)  # a third within one second
    assert window.take(11.0)  # the first has left the span
    assert not window.take(11.4)
    assert window.take(11.6)


def test_a_refused_event_is_not_counted() -> None:
    window = Window(1, 1.0)
    assert window.take(0.0)
    for t in (0.1, 0.5, 0.9):
        assert not window.take(t)
    assert window.take(1.0)  # refusals did not push the window on


def test_the_message_and_command_windows() -> None:
    messages, commands = messages_window(), commands_window()
    assert [messages.take(5.0) for _ in range(11)] == [True] * 10 + [False]
    assert [commands.take(5.0) for _ in range(3)] == [True, True, False]


def test_the_gate_counts_connections_per_address_per_minute() -> None:
    gate, here, there = AddressGate(), b"a" * 32, b"b" * 32
    for _ in range(CONNECTIONS_PER_MINUTE):
        assert gate.admit(here, 0.0)
        gate.hello_over(here)
    assert not gate.admit(here, 59.9)
    assert gate.admit(there, 59.9)  # another address is its own count
    assert gate.admit(here, 60.0)


def test_the_gate_holds_waiting_connections_per_address() -> None:
    gate, here = AddressGate(), b"a" * 32
    for i in range(WAITING_FOR_HELLO):
        assert gate.admit(here, float(i))
    assert not gate.admit(here, 200.0)
    gate.hello_over(here)
    assert gate.admit(here, 200.0)
    gate.hello_over(b"never" * 7)  # unknown: nothing happens


def test_the_gate_forgets_idle_addresses() -> None:
    gate = AddressGate()
    for i in range(5000):
        key = i.to_bytes(32, "big")
        assert gate.admit(key, 0.0)
        gate.hello_over(key)
    assert gate.admit(b"z" * 32, 120.0)
    assert gate.held() < 5000


def test_the_size_limits() -> None:
    assert not too_big_(HELLO_MAX_BYTES, after_hello=False)
    assert too_big_(HELLO_MAX_BYTES + 1, after_hello=False)
    assert not too_big_(MESSAGE_MAX_BYTES, after_hello=True)
    assert too_big_(MESSAGE_MAX_BYTES + 1, after_hello=True)
