"""The network guard (tests/netguard.py) is on in every test: loopback only."""

from __future__ import annotations

import socket

import pytest

from tests.netguard import NetworkRefused, is_loopback


def test_a_lookup_of_another_name_is_refused(network_guard: list[str]) -> None:
    with pytest.raises(NetworkRefused):
        socket.getaddrinfo("smtp.example.com", 465)
    with pytest.raises(NetworkRefused):
        socket.gethostbyname("smtp.example.com")
    assert network_guard == ["name lookup", "name lookup"]
    network_guard.clear()


def test_a_connect_past_loopback_is_refused(network_guard: list[str]) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        with pytest.raises(NetworkRefused):
            sock.connect(("192.0.2.1", 25))
        with pytest.raises(NetworkRefused):
            sock.connect_ex(("192.0.2.1", 25))
    # create_connection looks the address up first, and that is refused already.
    with pytest.raises(NetworkRefused):
        socket.create_connection(("192.0.2.1", 25), timeout=1)
    assert network_guard[0] == "connect" and len(network_guard) == 3
    network_guard.clear()


def test_loopback_is_allowed(network_guard: list[str]) -> None:
    with socket.create_server(("127.0.0.1", 0)) as server:
        port = server.getsockname()[1]
        with socket.create_connection(("localhost", port), timeout=1):
            pass
    assert network_guard == []


@pytest.mark.parametrize(
    ("host", "loopback"),
    [("localhost", True), ("127.0.0.1", True), ("::1", True), (b"127.0.0.2", True),
     ("10.0.0.1", False), ("example.test", False), ("localhost.example.test", False)],
)  # fmt: skip
def test_what_counts_as_loopback(host: str | bytes, loopback: bool) -> None:
    assert is_loopback(host) is loopback
