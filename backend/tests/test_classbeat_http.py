"""The backend's calls to classbeat (ADR 0010, sections 2 and 3; #481), against a server on the
loopback address in this process. No other network is reached (tests/netguard.py)."""

from __future__ import annotations

import base64
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote

import pytest

from player_backend.classbeat_http import (
    READ_MAX,
    ClassbeatUnreachable,
    UrllibTransport,
    basic_credentials,
)

SECRET = "s3cr:et/+%"  # noqa: S105 (made up here)


class _Handler(BaseHTTPRequestHandler):
    seen: list[tuple[str, str, dict[str, str], bytes]] = []

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def _answer(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        self.seen.append((self.command, self.path, dict(self.headers.items()), body))
        if self.path.startswith("/redirect"):
            self.send_response(302)
            self.send_header("Location", "/keys")
            self.end_headers()
            return
        if self.path.startswith("/large"):
            payload = b"x" * (READ_MAX + 1)
        elif self.path.startswith("/fail"):
            self.send_response(400)
            self.end_headers()
            return
        else:
            payload = b'{"ok": true}'
        self.send_response(200)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = _answer  # noqa: N815
    do_POST = _answer  # noqa: N815


@pytest.fixture
def server() -> Iterator[str]:
    _Handler.seen = []
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_the_token_call_posts_the_form_with_client_secret_basic(server: str) -> None:
    transport = UrllibTransport(server + "/token", server + "/keys", "player id", SECRET)
    assert transport.post_token({"grant_type": "authorization_code", "code": "c1"}) == (
        b'{"ok": true}'
    )
    method, path, headers, body = _Handler.seen[-1]
    assert (method, path) == ("POST", "/token")
    assert parse_qs(body.decode()) == {"grant_type": ["authorization_code"], "code": ["c1"]}
    scheme, _, encoded = headers["Authorization"].partition(" ")
    user, _, password = base64.b64decode(encoded).decode().partition(":")
    assert scheme == "Basic" and unquote(user) == "player id" and unquote(password) == SECRET
    assert headers["Content-Type"] == "application/x-www-form-urlencoded"


def test_the_key_call_sends_no_credential(server: str) -> None:
    transport = UrllibTransport(server + "/token", server + "/keys", "player", SECRET)
    assert transport.get_keys() == b'{"ok": true}'
    method, path, headers, _ = _Handler.seen[-1]
    assert (method, path) == ("GET", "/keys") and "Authorization" not in headers


def test_a_redirect_is_not_followed(server: str) -> None:
    transport = UrllibTransport(server + "/redirect", server + "/redirect", "player", SECRET)
    with pytest.raises(ClassbeatUnreachable):
        transport.post_token({"code": "c1"})
    assert [path for _, path, _, _ in _Handler.seen] == ["/redirect"]


def test_an_answer_over_64_kib_is_refused(server: str) -> None:
    transport = UrllibTransport(server + "/large", server + "/large", "player", SECRET)
    with pytest.raises(ClassbeatUnreachable):
        transport.get_keys()


def test_an_answer_other_than_200_is_refused_and_holds_nothing_of_the_call(server: str) -> None:
    transport = UrllibTransport(server + "/fail", server + "/fail", "player", SECRET)
    with pytest.raises(ClassbeatUnreachable) as refused:
        transport.post_token({"code": "the-code"})
    assert "the-code" not in str(refused.value) and SECRET not in str(refused.value)


def test_nothing_listening_is_unreachable() -> None:
    transport = UrllibTransport("http://127.0.0.1:9/token", "http://127.0.0.1:9/k", "p", SECRET)
    with pytest.raises(ClassbeatUnreachable):
        transport.get_keys()


def test_the_secret_is_not_in_the_transports_repr() -> None:
    transport = UrllibTransport("https://classbeat.test/t", "https://classbeat.test/k", "p", SECRET)
    assert SECRET not in repr(transport)
    assert basic_credentials("p", SECRET) not in repr(transport)
