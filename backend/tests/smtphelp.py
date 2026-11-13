"""A fake SMTP server on loopback, and throwaway certificates for it (tests only).

The certificates are made for each test run with the `openssl` command, in a temporary
directory: a test CA, a server certificate for `localhost` and one for another name. Nothing
here is a real key or reaches the network.
"""

from __future__ import annotations

import socket
import ssl
import subprocess
import threading
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

# implicit: TLS from the first byte. starttls: STARTTLS offered. plain: AUTH offered, no TLS.
# silent: accepts and says nothing. drip: a greeting one byte at a time, never finished.
# rcpt_refused: implicit TLS, then refuses the recipient, quoting it, as a real server might.
# quit_dropped: implicit TLS, takes the mail, then hangs up on QUIT without an answer.
type Mode = Literal[
    "implicit", "starttls", "plain", "silent", "drip", "rcpt_refused", "quit_dropped"
]

PASSWORD = "fake-smtp-password-0f3c"  # Made up; the fake checks nothing.


@dataclass(frozen=True)
class Certs:
    ca: Path
    server: tuple[Path, Path]  # For localhost and 127.0.0.1.
    wrong_name: tuple[Path, Path]  # For other.test only.

    def client_context(self) -> ssl.SSLContext:
        context = ssl.create_default_context(cafile=str(self.ca))
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        return context

    def server_context(self, *, wrong_name: bool = False) -> ssl.SSLContext:
        cert, key = self.wrong_name if wrong_name else self.server
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(str(cert), str(key))
        return context


def _openssl(*args: str) -> None:
    subprocess.run(["openssl", *args], check=True, capture_output=True)


def make_certs(directory: Path) -> Certs:
    ec = ("-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes")
    ca, ca_key = directory / "ca.pem", directory / "ca.key"
    _openssl(
        "req", "-x509", *ec, "-keyout", str(ca_key), "-out", str(ca), "-days", "2",
        "-subj", "/CN=classbeat-player test CA",
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    )  # fmt: skip

    def leaf(name: str, alt_names: str) -> tuple[Path, Path]:
        cert, key, csr = (directory / f"{name}.{ext}" for ext in ("pem", "key", "csr"))
        ext = directory / f"{name}.ext"
        ext.write_text(
            f"subjectAltName={alt_names}\nbasicConstraints=CA:FALSE\n"
            "keyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n"
            "authorityKeyIdentifier=keyid\nsubjectKeyIdentifier=hash\n",
            encoding="utf-8",
        )
        _openssl("req", *ec, "-keyout", str(key), "-out", str(csr), "-subj", f"/CN={name}")
        _openssl(
            "x509", "-req", "-in", str(csr), "-CA", str(ca), "-CAkey", str(ca_key),
            "-CAcreateserial", "-out", str(cert), "-days", "2", "-extfile", str(ext),
        )  # fmt: skip
        return cert, key

    return Certs(
        ca=ca,
        server=leaf("localhost", "DNS:localhost,IP:127.0.0.1"),
        wrong_name=leaf("other", "DNS:other.test"),
    )


@dataclass
class FakeSmtp:
    mode: Mode
    tls: ssl.SSLContext | None
    port: int = 0
    # Every command line received, with whether it came over TLS.
    lines: list[tuple[bool, bytes]] = field(default_factory=list[tuple[bool, bytes]])
    messages: list[bytes] = field(default_factory=list[bytes])
    stop: threading.Event = field(default_factory=threading.Event)

    def serve(self, listener: socket.socket) -> None:
        listener.settimeout(0.1)
        while not self.stop.is_set():
            try:
                conn, _ = listener.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            threading.Thread(target=self._conversation, args=(conn,), daemon=True).start()

    def _conversation(self, conn: socket.socket) -> None:
        try:
            with conn:
                self._talk(conn)
        except (OSError, ValueError):
            pass  # The client went away, or its TLS check failed: the test looks at the client.

    def _talk(self, conn: socket.socket) -> None:
        conn.settimeout(10)
        if self.mode == "silent":
            self.stop.wait(10)
            return
        if self.mode == "drip":
            conn.sendall(b"220 ")
            # For 3 seconds at most, so that a mailer without its limit fails instead of hanging.
            for _ in range(60):
                if self.stop.wait(0.05):
                    break
                conn.sendall(b"x")
            return
        over_tls = False
        if self.mode in ("implicit", "rcpt_refused", "quit_dropped"):
            assert self.tls is not None
            conn = self.tls.wrap_socket(conn, server_side=True)
            over_tls = True
        reader = conn.makefile("rb")
        conn.sendall(b"220 fake ready\r\n")
        while line := reader.readline():
            command = line.rstrip(b"\r\n")
            self.lines.append((over_tls, command))
            verb = command.split(b" ", 1)[0].upper()
            if verb == b"EHLO":
                offer = b"250-STARTTLS\r\n" if self.mode == "starttls" and not over_tls else b""
                conn.sendall(b"250-fake\r\n" + offer + b"250 AUTH PLAIN LOGIN\r\n")
            elif verb == b"STARTTLS":
                assert self.tls is not None
                conn.sendall(b"220 go ahead\r\n")
                conn = self.tls.wrap_socket(conn, server_side=True)
                reader = conn.makefile("rb")
                over_tls = True
            elif verb == b"AUTH":
                conn.sendall(b"235 ok\r\n")
            elif verb == b"RCPT" and self.mode == "rcpt_refused":
                conn.sendall(b"550 no mailbox " + command.split(b":", 1)[1] + b"\r\n")
            elif verb in (b"MAIL", b"RCPT", b"RSET", b"NOOP"):
                conn.sendall(b"250 ok\r\n")
            elif verb == b"DATA":
                conn.sendall(b"354 go on\r\n")
                body = b""
                while (part := reader.readline()) not in (b".\r\n", b""):
                    body += part
                self.messages.append(body)
                conn.sendall(b"250 queued\r\n")
            elif verb == b"QUIT":
                if self.mode == "quit_dropped":
                    reader.close()
                    conn.close()
                    return
                conn.sendall(b"221 bye\r\n")
                return
            else:
                conn.sendall(b"500 what\r\n")

    def received(self) -> bytes:
        return b"\n".join(line for _, line in self.lines)


@contextmanager
def fake_smtp(mode: Mode, tls: ssl.SSLContext | None = None) -> Generator[FakeSmtp]:
    listener = socket.create_server(("127.0.0.1", 0))
    server = FakeSmtp(mode=mode, tls=tls, port=listener.getsockname()[1])
    thread = threading.Thread(target=server.serve, args=(listener,), daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.stop.set()
        listener.close()
        thread.join(timeout=5)
