"""The mailer that hands mail to an SMTP server (issue #83). Which server is the owner's choice.

- TLS always: implicit TLS (usually port 465) or STARTTLS (587). Certificate and host name are
  verified with the system's trust store, TLS 1.2 at least. A server that offers no STARTTLS,
  or refuses it, gets no login and no mail: the conversation ends before either.
- The whole of `send` keeps to its `timeout` (smtp_deadline.py).
- Nothing is logged or printed here (smtplib's debug output stays off). A failure is raised to
  `deliver`, which logs the error's type alone: an error can quote the server's answer, and so
  an address. The password, the body (which holds sign-in links) and the recipient stay out.
"""

from __future__ import annotations

import smtplib
import socket
import ssl
import threading
from collections.abc import Mapping
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from email.utils import formatdate, make_msgid
from typing import Any

from player_backend.mail import Mail
from player_backend.smtp_deadline import Deadline
from player_backend.smtp_settings import SmtpSettings


def tls_context() -> ssl.SSLContext:
    """The system's trust store, certificate and host name checked, TLS 1.2 at least."""
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


def _checked(context: ssl.SSLContext) -> ssl.SSLContext:
    if context.verify_mode != ssl.CERT_REQUIRED or not context.check_hostname:
        raise ValueError("the SMTP TLS context must verify the certificate and the host name")
    # `MINIMUM_SUPPORTED` is below every version, so it is refused too.
    if context.minimum_version < ssl.TLSVersion.TLSv1_2:
        raise ValueError("the SMTP TLS context must require TLS 1.2 at least")
    return context


type _Address = tuple[socket.AddressFamily, socket.SocketKind, int, str, Any]


def _addresses(deadline: Deadline, host: str, port: int) -> list[_Address]:
    """The addresses of `host`, looked up within the time that is left (#101 review, note 3).

    The system's lookup cannot be interrupted, so it runs on a thread of its own and is waited
    for no longer than the time left. A lookup that takes longer is left to finish on its own;
    what it finds is dropped.
    """
    found: list[_Address] = []
    failed: list[BaseException] = []
    done = threading.Event()

    def look_up() -> None:
        try:
            found.extend(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
        except BaseException as error:
            failed.append(error)
        finally:
            done.set()

    threading.Thread(target=look_up, name="smtp-lookup", daemon=True).start()
    if not done.wait(deadline.left()):
        raise TimeoutError("the mail service took too long")
    if failed:
        raise failed[0]
    return found


def _connect(deadline: Deadline, host: str, port: int) -> socket.socket:
    """A connection to the first address of `host` that answers, all within the time left.

    The lookup, then address by address, each held by the deadline and given only the time that
    is left, so a slow lookup and several addresses that do not answer cannot take more than the
    whole limit together.
    """
    last: OSError = OSError("the mail service's host has no address")
    for family, kind, proto, _, address in _addresses(deadline, host, port):
        sock = socket.socket(family, kind, proto)
        try:
            deadline.hold(sock)
            sock.connect(address)
        except OSError as error:
            deadline.release()
            sock.close()
            if isinstance(error, TimeoutError) or deadline.expired:
                raise
            last = error
            continue
        except BaseException:
            deadline.release()
            sock.close()
            raise
        return sock
    raise last


def message_bytes(settings: SmtpSettings, mail: Mail) -> bytes:
    """The message as sent. A line break in a header value is refused (no header injection)."""
    message = EmailMessage(policy=SMTP_POLICY)
    message["From"] = settings.sender
    message["To"] = mail.to
    message["Subject"] = mail.subject
    message["Date"] = formatdate(usegmt=True)
    message["Message-ID"] = make_msgid(domain=settings.sender.rpartition("@")[2])
    # Plain 7-bit when it can be, so that the sign-in link stays on one line as written.
    plain = mail.body.isascii() and all(len(line) <= 998 for line in mail.body.splitlines())
    message.set_content(mail.body, cte="7bit" if plain else "quoted-printable")
    return message.as_bytes()


class SmtpMailer:
    def __init__(self, settings: SmtpSettings, context: ssl.SSLContext | None = None) -> None:
        self._settings = settings
        self._context = _checked(context if context is not None else tls_context())

    def __repr__(self) -> str:
        return f"SmtpMailer(host={self._settings.host!r}, port={self._settings.port})"

    def send(self, mail: Mail, *, timeout: float) -> None:
        content = message_bytes(self._settings, mail)
        context = _checked(self._context)
        with Deadline(timeout) as deadline:
            try:
                self._converse(deadline, context, mail.to, content)
            except Exception:
                if deadline.expired:
                    # The error the cut connection raised says nothing useful; this says why.
                    raise TimeoutError("the mail service took too long") from None
                raise

    def _converse(
        self, deadline: Deadline, context: ssl.SSLContext, to: str, content: bytes
    ) -> None:
        s = self._settings
        sock = _connect(deadline, s.host, s.port)
        client: smtplib.SMTP | None = None
        try:
            if s.tls == "implicit":
                sock = self._wrap(deadline, context, sock)
            # No host given, so smtplib connects nothing itself: it talks over `sock`.
            client = smtplib.SMTP(local_hostname=s.helo_name, timeout=deadline.left())
            client.sock = sock
            _expect(client.getreply(), 220)
            deadline.step()
            client.ehlo()
            if s.tls == "starttls":
                if not client.has_extn("starttls"):
                    raise smtplib.SMTPNotSupportedError("the server offers no STARTTLS")
                deadline.step()
                _expect(client.docmd("STARTTLS"), 220)
                sock = self._wrap(deadline, context, sock)
                _restart(client, sock)
                deadline.step()
                client.ehlo()
            if s.user is not None and s.password is not None:
                deadline.step()
                client.login(s.user, s.password)
            deadline.step()
            client.sendmail(s.sender, [to], content)
            try:
                deadline.step()
                # Not `quit()`, which closes the socket while the deadline still holds it: the
                # socket is released first and closed after, below.
                client.docmd("QUIT")
            except (smtplib.SMTPException, OSError):
                # The mail was handed over: a failed goodbye does not make it unsent.
                pass
        finally:
            deadline.release()
            if client is not None:
                client.close()
            sock.close()

    def _wrap(
        self, deadline: Deadline, context: ssl.SSLContext, sock: socket.socket
    ) -> ssl.SSLSocket:
        wrapped = context.wrap_socket(
            sock, server_hostname=self._settings.host, do_handshake_on_connect=False
        )
        try:
            deadline.hold(wrapped)
            wrapped.do_handshake()
        except BaseException:
            deadline.release()
            wrapped.close()
            raise
        return wrapped


def _expect(reply: tuple[int, bytes], code: int) -> None:
    if reply[0] != code:
        raise smtplib.SMTPResponseException(reply[0], b"unexpected reply")


def _restart(client: smtplib.SMTP, sock: ssl.SSLSocket) -> None:
    """After STARTTLS: the new socket, and nothing kept from before it (RFC 3207, section 4.2).

    Dropping the old reader drops any reply the server sent ahead in the clear.
    """
    client.sock = sock
    client.file = None
    client.helo_resp = None
    client.ehlo_resp = None
    client.esmtp_features = {}
    client.does_esmtp = False


def mailer_from_env(env: Mapping[str, str] | None = None) -> SmtpMailer | None:
    """The SMTP mailer when `PLAYER_SMTP_HOST` is set; None keeps the app's `NoMailer`."""
    settings = SmtpSettings.from_env(env)
    return SmtpMailer(settings) if settings is not None else None
