"""How the SMTP mailer uses its deadline (smtp_mailer.py; #101 review, notes 2 and 3): every
socket it held is released before it is closed, after a mail is handed over and after a
failure, and a slow name lookup is bound by the one time limit.

Against the fake server on loopback (tests/smtphelp.py) and a fake lookup; nothing reaches the
network.
"""

from __future__ import annotations

import smtplib
import socket
import threading
import time

import pytest

from player_backend import smtp_mailer
from player_backend.login_policy import sign_in_mail
from player_backend.mail import Mail
from player_backend.smtp_deadline import Deadline
from player_backend.smtp_mailer import SmtpMailer
from player_backend.smtp_settings import SmtpSettings, TlsMode
from player_backend.token_issue import new_token
from tests.smtphelp import PASSWORD, Certs, Mode, fake_smtp, make_certs


@pytest.fixture(scope="module")
def certs(tmp_path_factory: pytest.TempPathFactory) -> Certs:
    return make_certs(tmp_path_factory.mktemp("smtp-certs"))


def _settings(port: int, tls: TlsMode) -> SmtpSettings:
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


class RecordingDeadline(Deadline):
    """A deadline that records, at each release, whether the socket it held was still open."""

    made: list[RecordingDeadline] = []

    def __init__(self, seconds: float) -> None:
        super().__init__(seconds)
        self.held: socket.socket | None = None
        self.releases: list[bool] = []
        RecordingDeadline.made.append(self)

    def hold(self, sock: socket.socket) -> None:
        self.held = sock
        super().hold(sock)

    def release(self) -> None:
        if self.held is not None:
            self.releases.append(self.held.fileno() != -1)
        self.held = None
        super().release()


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> list[RecordingDeadline]:
    RecordingDeadline.made = []
    monkeypatch.setattr(smtp_mailer, "Deadline", RecordingDeadline)
    return RecordingDeadline.made


@pytest.mark.parametrize(("mode", "tls"), [("implicit", "implicit"), ("starttls", "starttls")])
def test_the_socket_is_released_before_it_is_closed_after_a_mail(
    certs: Certs, recorded: list[RecordingDeadline], mode: Mode, tls: TlsMode
) -> None:
    with fake_smtp(mode, certs.server_context()) as server:
        SmtpMailer(_settings(server.port, tls), certs.client_context()).send(_mail(), timeout=5)
        assert len(server.messages) == 1
    [deadline] = recorded
    # Released while still open, and nothing held once `send` has returned.
    assert deadline.releases == [True] and deadline.held is None


def test_the_socket_is_released_before_it_is_closed_after_a_failure(
    certs: Certs, recorded: list[RecordingDeadline]
) -> None:
    with fake_smtp("rcpt_refused", certs.server_context()) as server:
        mailer = SmtpMailer(_settings(server.port, "implicit"), certs.client_context())
        with pytest.raises(smtplib.SMTPException):
            mailer.send(_mail(), timeout=5)
    [deadline] = recorded
    assert deadline.releases == [True] and deadline.held is None


def test_a_slow_name_lookup_keeps_to_the_one_limit(
    monkeypatch: pytest.MonkeyPatch, certs: Certs
) -> None:
    asked: list[str] = []
    finish = threading.Event()

    def slow_lookup(host: str, *args: object, **kwargs: object) -> list[object]:
        asked.append(host)
        finish.wait(10)
        return []

    monkeypatch.setattr(socket, "getaddrinfo", slow_lookup)
    started = time.monotonic()
    try:
        with pytest.raises(TimeoutError):
            SmtpMailer(_settings(465, "implicit"), certs.client_context()).send(
                _mail(), timeout=0.5
            )
        assert time.monotonic() - started < 0.9
        assert asked == ["localhost"]
    finally:
        finish.set()


def test_a_failed_name_lookup_is_raised_as_it_is(
    monkeypatch: pytest.MonkeyPatch, certs: Certs
) -> None:
    def no_such_host(*args: object, **kwargs: object) -> list[object]:
        raise socket.gaierror(socket.EAI_NONAME, "no such host")

    monkeypatch.setattr(socket, "getaddrinfo", no_such_host)
    with pytest.raises(socket.gaierror):
        SmtpMailer(_settings(465, "implicit"), certs.client_context()).send(_mail(), timeout=5)
