"""The backend's calls to classbeat (ADR 0010, sections 2 and 3): the token endpoint and the key
set. The only module that reaches classbeat over the network.

Every call follows no redirect, times out after 5 seconds and reads at most 64 KiB; any other
answer than `200` is a failure. No proxy from the environment is used: the call goes to the
configured address and nowhere else. A failure is a `ClassbeatUnreachable` that carries no part
of a request or an answer: no code, verifier, secret or token is in an error or a log line.
"""

from __future__ import annotations

import base64
import urllib.error
import urllib.request
from collections.abc import Mapping
from typing import Final, NoReturn
from urllib.parse import quote, urlencode

TIMEOUT: Final = 5.0
READ_MAX: Final = 64 * 1024


class ClassbeatUnreachable(RuntimeError):
    """A call to classbeat failed. Carries a fixed word only."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> NoReturn:
        raise ClassbeatUnreachable("redirect")


_OPENER: Final = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def basic_credentials(client_id: str, secret: str) -> str:
    """`client_secret_basic` (RFC 6749, section 2.3.1): each part form-encoded first."""
    pair = quote(client_id, safe="") + ":" + quote(secret, safe="")
    return "Basic " + base64.b64encode(pair.encode("utf-8")).decode("ascii")


def _call(request: urllib.request.Request) -> bytes:
    try:
        with _OPENER.open(request, timeout=TIMEOUT) as answer:
            if answer.status != 200:
                raise ClassbeatUnreachable("status")
            body: bytes = answer.read(READ_MAX + 1)
    except ClassbeatUnreachable:
        raise
    except (urllib.error.URLError, OSError, ValueError):
        raise ClassbeatUnreachable("network") from None
    if len(body) > READ_MAX:
        raise ClassbeatUnreachable("size")
    return body


class UrllibTransport:
    """The transport of production: plain HTTPS calls to the configured addresses."""

    def __init__(self, token_url: str, keys_url: str, client_id: str, secret: str) -> None:
        self._token_url = token_url
        self._keys_url = keys_url
        self._authorization = basic_credentials(client_id, secret)

    def __repr__(self) -> str:
        return "<UrllibTransport>"

    def post_token(self, form: Mapping[str, str]) -> bytes:
        request = urllib.request.Request(
            self._token_url,
            data=urlencode(form).encode("ascii"),
            method="POST",
            headers={
                "Authorization": self._authorization,
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        )
        return _call(request)

    def get_keys(self) -> bytes:
        request = urllib.request.Request(
            self._keys_url, method="GET", headers={"Accept": "application/json"}
        )
        return _call(request)
