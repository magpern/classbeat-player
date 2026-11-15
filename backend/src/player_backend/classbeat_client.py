"""classbeat as the site's sign-in provider (ADR 0010, sections 2 and 3): the authorize address,
the code exchange and the ID token's check, over a transport handed in.

The transport is `classbeat_http.UrllibTransport` in production and a fake in the tests. Of the
token endpoint's answer only `id_token` is read; the access token and any refresh token are
dropped unread, and no user-info call is made.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Protocol, cast

from player_backend.classbeat_flow_policy import Purpose, authorize_address, code_challenge
from player_backend.classbeat_http import ClassbeatUnreachable, UrllibTransport
from player_backend.classbeat_keys import KeySet
from player_backend.classbeat_policy import Identity
from player_backend.classbeat_settings import ClassbeatSettings
from player_backend.classbeat_token_check import TokenRefused, check_id_token


class Transport(Protocol):
    def post_token(self, form: Mapping[str, str]) -> bytes: ...

    def get_keys(self) -> bytes: ...


@dataclass(frozen=True)
class ClassbeatClient:
    settings: ClassbeatSettings
    transport: Transport = field(repr=False)
    keys: KeySet = field(repr=False)
    clock: Callable[[], float] = time.time

    def authorize(self, *, state: str, nonce: str, verifier: str, purpose: Purpose) -> str:
        """The authorize address for a flow whose PKCE verifier is the binding token."""
        return authorize_address(
            self.settings.authorize_url,
            client_id=self.settings.client_id,
            redirect_uri=self.settings.redirect_uri,
            state=state,
            nonce=nonce,
            challenge=code_challenge(verifier),
            purpose=purpose,
        )

    def identity(self, *, code: str, verifier: str, nonce_hash: bytes) -> Identity:
        """Exchange the code and check the ID token. `TokenRefused` or `ClassbeatUnreachable`."""
        body = self.transport.post_token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.settings.redirect_uri,
                "code_verifier": verifier,
            }
        )
        return check_id_token(
            _id_token(body),
            self.keys.keys_for,
            issuer=self.settings.issuer,
            client_id=self.settings.client_id,
            expected_nonce_hash=nonce_hash,
            now=int(self.clock()),
        )


def _id_token(body: bytes) -> str:
    try:
        answer: object = json.loads(body)
    except (UnicodeDecodeError, ValueError):
        raise ClassbeatUnreachable("answer") from None
    token = cast(dict[str, object], answer).get("id_token") if isinstance(answer, dict) else None
    if not isinstance(token, str):
        raise TokenRefused("form")
    return token


def client_from(settings: ClassbeatSettings, transport: Transport | None = None) -> ClassbeatClient:
    """The client of `settings`: over HTTPS in production, or over the `transport` given."""
    used: Transport = transport or UrllibTransport(
        settings.token_url, settings.keys_url, settings.client_id, settings.client_secret
    )
    return ClassbeatClient(settings, used, KeySet(used.get_keys))
