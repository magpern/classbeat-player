"""The network guard: no test reaches past the loopback interface.

An autouse fixture (registered in conftest.py) refuses, before anything is sent, every Python
`connect` to an address that is not loopback and every name lookup of a name that is not
`localhost` or a loopback address. A refusal raises, and is also recorded and failed at the end
of the test, so code that catches every error (as `deliver` does) cannot hide it. The database
driver connects through libpq, not Python's sockets; the test database is on loopback anyway.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Iterator
from typing import Any

import pytest

_LOCAL_NAMES = frozenset({"localhost", "localhost.", "ip6-localhost"})


class NetworkRefused(RuntimeError):
    """A test tried to reach the network."""


def is_loopback(host: object) -> bool:
    if host is None:
        return True  # A passive lookup for a server's own bind address.
    name = host.decode() if isinstance(host, bytes) else str(host)
    if name.lower() in _LOCAL_NAMES:
        return True
    try:
        return ipaddress.ip_address(name.split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def _host_of(address: object) -> object:
    if isinstance(address, tuple):
        parts: tuple[object, ...] = address  # pyright: ignore[reportUnknownVariableType]
        return parts[0] if parts else None
    return "localhost" if isinstance(address, str | bytes) else address  # A Unix socket path.


@pytest.fixture(autouse=True)
def network_guard(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[str]]:
    refused: list[str] = []

    def refuse(what: str) -> None:
        refused.append(what)
        raise NetworkRefused(f"no network in tests: {what}")

    def guarded(real: Callable[..., Any]) -> Callable[..., Any]:
        def connect(sock: socket.socket, address: Any) -> Any:
            if sock.family in (socket.AF_INET, socket.AF_INET6) and not is_loopback(
                _host_of(address)
            ):
                refuse("connect")
            return real(sock, address)

        return connect

    def lookup(real: Callable[..., Any]) -> Callable[..., Any]:
        def by_name(host: Any, *args: Any, **kwargs: Any) -> Any:
            if not is_loopback(host):
                refuse("name lookup")
            return real(host, *args, **kwargs)

        return by_name

    monkeypatch.setattr(socket, "getaddrinfo", lookup(socket.getaddrinfo))
    monkeypatch.setattr(socket, "gethostbyname", lookup(socket.gethostbyname))
    monkeypatch.setattr(socket, "gethostbyname_ex", lookup(socket.gethostbyname_ex))
    monkeypatch.setattr(socket, "gethostbyaddr", lookup(socket.gethostbyaddr))
    monkeypatch.setattr(socket.socket, "connect", guarded(socket.socket.connect))
    monkeypatch.setattr(socket.socket, "connect_ex", guarded(socket.socket.connect_ex))
    yield refused
    assert refused == [], f"a test tried to reach the network: {refused}"
