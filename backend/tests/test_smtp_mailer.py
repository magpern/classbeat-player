"""The SMTP mailer (smtp_mailer.py) against a fake server on loopback (tests/smtphelp.py).

TLS is required and verified, the time limit holds for the whole conversation, and nothing of
the password, the body or the recipient reaches a log line or the terminal.
"""

from __future__ import annotations

import logging
import ssl
import time
from collections.abc import Iterator
from dataclasses import replace

import pytest

from player_backend.login_policy import sign_in_mail
from player_backend.mail import Mail
from player_backend.mail_delivery import deliver
from player_backend.smtp_mailer import SmtpMailer, message_bytes, tls_context
from player_backend.smtp_settings import SmtpSettings, TlsMode
from player_backend.token_issue import new_token
from tests.smtphelp import PASSWORD, Certs, FakeSmtp, Mode, fake_smtp, make_certs

RIDER = "rider@example.test"
SENDER = "noreply@player.example.test"


@pytest.fixture(scope="module")
def certs(tmp_path_factory: pytest.TempPathFactory) -> Certs:
    return make_certs(tmp_path_factory.mktemp("smtp-certs"))


def _settings(port: int, tls: TlsMode, *, user: str | None = "mailer") -> SmtpSettings:
    return SmtpSettings(
        host="localhost",
        port=port,
        tls=tls,
        sender=SENDER,
        user=user,
        password=PASSWORD if user else None,
    )


def _mail() -> Mail:
    return sign_in_mail("https://player.example.test", RIDER, new_token("ml"))


@pytest.fixture
def server(request: pytest.FixtureRequest, certs: Certs) -> Iterator[FakeSmtp]:
    mode: Mode = request.param
    with fake_smtp(mode, certs.server_context()) as running:
        yield running


def _mailer(server: FakeSmtp, certs: Certs, tls: TlsMode) -> SmtpMailer:
    return SmtpMailer(_settings(server.port, tls), certs.client_context())


@pytest.mark.parametrize(
    ("server", "tls"), [("implicit", "implicit"), ("starttls", "starttls")], indirect=["server"]
)
def test_mail_is_handed_over_on_tls_only(server: FakeSmtp, certs: Certs, tls: TlsMode) -> None:
    mail = _mail()
    _mailer(server, certs, tls).send(mail, timeout=5)
    assert len(server.messages) == 1
    assert mail.body.splitlines()[2].encode() in server.messages[0]
    # Everything after the first EHLO came over TLS: the login, the envelope and the data.
    after_hello = server.lines[1:] if tls == "starttls" else server.lines
    plain = [line for over_tls, line in after_hello if not over_tls]
    assert plain in ([], [b"STARTTLS"])
    verbs = [line.split(b" ", 1)[0].upper() for _, line in server.lines]
    assert b"AUTH" in verbs and verbs[-1] == b"QUIT"
    assert any(f"<{RIDER}>".encode() in line for _, line in server.lines)


@pytest.mark.parametrize("server", ["plain"], indirect=True)
def test_no_starttls_means_no_login_and_no_mail(server: FakeSmtp, certs: Certs) -> None:
    with pytest.raises(Exception) as raised:
        _mailer(server, certs, "starttls").send(_mail(), timeout=5)
    assert type(raised.value).__name__ == "SMTPNotSupportedError"
    assert [line.split(b" ", 1)[0].upper() for _, line in server.lines] == [b"EHLO"]
    assert server.messages == []


@pytest.mark.parametrize("server", ["implicit"], indirect=True)
def test_an_untrusted_certificate_is_refused(server: FakeSmtp) -> None:
    # The system's trust store does not hold the test CA.
    mailer = SmtpMailer(_settings(server.port, "implicit"))
    with pytest.raises(ssl.SSLCertVerificationError):
        mailer.send(_mail(), timeout=5)
    assert server.lines == []


def test_a_certificate_for_another_name_is_refused(certs: Certs) -> None:
    with fake_smtp("implicit", certs.server_context(wrong_name=True)) as server:
        with pytest.raises(ssl.SSLCertVerificationError):
            _mailer(server, certs, "implicit").send(_mail(), timeout=5)
        assert server.lines == []


def test_a_context_that_does_not_verify_is_refused(certs: Certs) -> None:
    lax = certs.client_context()
    lax.check_hostname = False
    with pytest.raises(ValueError, match="verify"):
        SmtpMailer(_settings(25, "implicit"), lax)
    unverified = certs.client_context()
    unverified.check_hostname = False
    unverified.verify_mode = ssl.CERT_NONE
    with pytest.raises(ValueError, match="verify"):
        SmtpMailer(_settings(25, "implicit"), unverified)


def test_a_context_weakened_after_creation_is_refused_at_send(certs: Certs) -> None:
    context = certs.client_context()
    mailer = SmtpMailer(_settings(25, "implicit"), context)
    context.check_hostname = False
    with pytest.raises(ValueError, match="verify"):
        mailer.send(_mail(), timeout=1)


def test_the_default_context_verifies() -> None:
    context = tls_context()
    assert context.verify_mode == ssl.CERT_REQUIRED and context.check_hostname
    assert context.minimum_version >= ssl.TLSVersion.TLSv1_2


@pytest.mark.parametrize(
    ("mode", "tls"),
    [("silent", "starttls"), ("silent", "implicit"), ("drip", "starttls")],
)
def test_the_time_limit_holds_for_the_whole_conversation(
    certs: Certs, mode: Mode, tls: TlsMode
) -> None:
    # silent: no greeting, or no TLS handshake. drip: a byte every 50 ms, so no single read
    # ever waits long; only the limit on the whole conversation ends it.
    with fake_smtp(mode, certs.server_context()) as server:
        started = time.monotonic()
        with pytest.raises(TimeoutError):
            _mailer(server, certs, tls).send(_mail(), timeout=0.6)
        assert time.monotonic() - started < 2.0


def test_a_header_with_a_line_break_is_refused() -> None:
    settings = _settings(25, "implicit")
    for mail in (
        Mail(to=RIDER + "\r\nBcc: other@example.test", subject="s", body="b"),
        Mail(to=RIDER, subject="s\nBcc: other@example.test", body="b"),
    ):
        with pytest.raises(ValueError):
            message_bytes(settings, mail)


def test_the_message_has_the_sender_and_recipient() -> None:
    content = message_bytes(_settings(25, "implicit"), _mail())
    assert f"From: {SENDER}".encode() in content and f"To: {RIDER}".encode() in content
    assert b"Message-ID: <" in content and b"@player.example.test>" in content


def test_no_login_without_a_user(certs: Certs) -> None:
    with fake_smtp("implicit", certs.server_context()) as server:
        settings = _settings(server.port, "implicit", user=None)
        SmtpMailer(settings, certs.client_context()).send(_mail(), timeout=5)
        assert all(not line.upper().startswith(b"AUTH") for _, line in server.lines)
        assert len(server.messages) == 1


def test_repr_holds_no_password() -> None:
    settings = _settings(25, "implicit")
    assert PASSWORD not in repr(settings) and PASSWORD not in repr(SmtpMailer(settings))
    assert PASSWORD not in repr(replace(settings, user="someone"))


def _nothing_secret(text: str, mail: Mail) -> None:
    assert PASSWORD not in text
    assert mail.to not in text and mail.subject not in text
    for line in mail.body.splitlines():
        assert not line.strip() or line not in text
    assert "sign-in#" not in text and "cbp_ml_" not in text


class ShortLimit:
    """Hands the mail on with a short limit, so that `silent` ends soon. Goes through `deliver`."""

    def __init__(self, mailer: SmtpMailer) -> None:
        self.mailer = mailer

    def send(self, mail: Mail, *, timeout: float) -> None:
        self.mailer.send(mail, timeout=min(timeout, 0.5))


@pytest.mark.parametrize(
    ("mode", "tls", "logged"),
    [
        ("implicit", "implicit", None),
        ("starttls", "starttls", None),
        # The fake quotes the recipient in its refusal: the error holds it, the log must not.
        ("rcpt_refused", "implicit", "SMTPRecipientsRefused"),
        ("plain", "starttls", "SMTPNotSupportedError"),
        ("silent", "implicit", "TimeoutError"),
    ],
)
def test_no_password_body_or_recipient_reaches_the_logs(
    certs: Certs,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    mode: Mode,
    tls: TlsMode,
    logged: str | None,
) -> None:
    caplog.set_level(logging.DEBUG)
    mail = _mail()
    with fake_smtp(mode, certs.server_context()) as server:
        mailer = SmtpMailer(_settings(server.port, tls), certs.client_context())
        deliver(ShortLimit(mailer), mail)
    assert all(record.exc_info is None for record in caplog.records)
    text = caplog.text + "".join(repr(vars(record)) for record in caplog.records)
    captured = capsys.readouterr()
    _nothing_secret(text + captured.out + captured.err, mail)
    failures = [r.getMessage() for r in caplog.records if r.name == "player_backend.mail"]
    assert failures == ([] if logged is None else [f"mail not sent: {logged}"])
