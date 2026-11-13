"""The SMTP mailer at its edges (smtp_mailer.py, smtp_deadline.py; #90 review notes N2 to N5):
connecting within the one time limit, the watchdog and a closed socket, the TLS version an
injected context may allow, and a goodbye that fails after the mail was handed over.

Against the fake server on loopback (tests/smtphelp.py); nothing reaches the network.
"""

from __future__ import annotations

import socket
import ssl
import time
from collections.abc import Callable
from typing import Any

import pytest

from player_backend.login_policy import sign_in_mail
from player_backend.mail import Mail
from player_backend.smtp_deadline import Deadline
from player_backend.smtp_mailer import SmtpMailer
from player_backend.smtp_settings import SmtpSettings, TlsMode
from player_backend.token_issue import new_token
from tests.smtphelp import PASSWORD, Certs, fake_smtp, make_certs


@pytest.fixture(scope="module")
def certs(tmp_path_factory: pytest.TempPathFactory) -> Certs:
    return make_certs(tmp_path_factory.mktemp("smtp-certs"))


def _settings(port: int, tls: TlsMode = "implicit") -> SmtpSettings:
    return SmtpSettings(
        host="localhost",
        port=port,
        tls=tls,
        sender="noreply@player.example.test",
        user="mailer",
        password=PASSWORD,
    )


def _mail() -> Mail:
    return sign_in_mail("https://player.example.test", "rider@example.test", new_token("ml"))


type _Address = tuple[socket.AddressFamily, socket.SocketKind, int, str, tuple[str, int]]


def _resolving(addresses: list[_Address]) -> Callable[..., list[_Address]]:
    """A name lookup that answers these addresses, whatever it is asked."""

    def getaddrinfo(*args: object, **kwargs: object) -> list[_Address]:
        return addresses

    return getaddrinfo


class _NeverAnswers(socket.socket):
    """A connect that waits out its whole timeout, as an address that drops the SYN does."""

    tried: list[object] = []

    def connect(self, address: Any) -> None:
        _NeverAnswers.tried.append(address)
        timeout = self.gettimeout()
        time.sleep(timeout if timeout is not None else 10)
        raise TimeoutError("timed out")


def test_several_addresses_that_do_not_answer_keep_to_the_one_limit(
    monkeypatch: pytest.MonkeyPatch, certs: Certs
) -> None:
    addresses = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", (f"127.0.0.{n}", 25)) for n in range(2, 6)
    ]
    monkeypatch.setattr(socket, "getaddrinfo", _resolving(addresses))
    monkeypatch.setattr(socket, "socket", _NeverAnswers)
    _NeverAnswers.tried = []
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        SmtpMailer(_settings(25), certs.client_context()).send(_mail(), timeout=0.5)
    # Four addresses, each given the time left: no more than the limit in all.
    assert time.monotonic() - started < 0.9
    assert _NeverAnswers.tried == [("127.0.0.2", 25)]


def test_an_address_that_refuses_is_passed_over_for_the_next(
    monkeypatch: pytest.MonkeyPatch, certs: Certs
) -> None:
    with fake_smtp("implicit", certs.server_context()) as server:
        closed = socket.create_server(("127.0.0.1", 0))
        refusing = closed.getsockname()[1]
        closed.close()
        addresses = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", refusing)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", server.port)),
        ]
        monkeypatch.setattr(socket, "getaddrinfo", _resolving(addresses))
        SmtpMailer(_settings(server.port), certs.client_context()).send(_mail(), timeout=5)
        assert len(server.messages) == 1


def test_a_released_socket_is_never_shut_down_by_the_watchdog() -> None:
    mine, other = socket.socketpair()
    try:
        with Deadline(0.1) as deadline:
            deadline.hold(mine)
            deadline.release()
            time.sleep(0.3)
            assert deadline.expired
        # Still open both ways: the watchdog fired and left it alone.
        mine.settimeout(1)
        mine.sendall(b"x")
        assert other.recv(1) == b"x"
    finally:
        mine.close()
        other.close()


def test_a_held_socket_is_shut_down_when_the_limit_is_reached() -> None:
    mine, other = socket.socketpair()
    try:
        with Deadline(0.1) as deadline:
            deadline.hold(mine)
            time.sleep(0.3)
        assert mine.recv(1) == b""
    finally:
        mine.close()
        other.close()


@pytest.mark.filterwarnings("ignore:ssl.TLSVersion:DeprecationWarning")
@pytest.mark.parametrize(
    "version", [ssl.TLSVersion.MINIMUM_SUPPORTED, ssl.TLSVersion.TLSv1, ssl.TLSVersion.TLSv1_1]
)
def test_a_context_that_allows_tls_below_1_2_is_refused(
    certs: Certs, version: ssl.TLSVersion
) -> None:
    weak = certs.client_context()
    weak.minimum_version = version
    with pytest.raises(ValueError, match="TLS 1.2"):
        SmtpMailer(_settings(25), weak)
    # Weakened after it was given: refused at the send, before any connection.
    context = certs.client_context()
    mailer = SmtpMailer(_settings(25), context)
    context.minimum_version = version
    with pytest.raises(ValueError, match="TLS 1.2"):
        mailer.send(_mail(), timeout=1)


def test_a_failed_goodbye_after_the_mail_was_handed_over_is_no_failure(certs: Certs) -> None:
    with fake_smtp("quit_dropped", certs.server_context()) as server:
        started = time.monotonic()
        SmtpMailer(_settings(server.port), certs.client_context()).send(_mail(), timeout=5)
        assert len(server.messages) == 1
        assert time.monotonic() - started < 4
