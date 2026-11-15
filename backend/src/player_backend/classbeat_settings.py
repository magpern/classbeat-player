"""The settings of sign-in with classbeat (ADR 0010, sections 2 and 3), read from the environment.

The issuer and the three endpoints are settings, never discovered at run time. Each must be
HTTPS on the issuer's exact origin, and the redirect address must be the site's own callback,
or the backend refuses to start. The client secret is read only from the file named by
`PLAYER_CLASSBEAT_CLIENT_SECRET_FILE` (a deploy's secret mount, kept in `PLAYER_SECRETS_DIR`),
never from a variable that holds it. Without `PLAYER_CLASSBEAT_ISSUER` (and no other of these
settings) there is no classbeat sign-in. No error carries a value or the file's content.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final
from urllib.parse import urlsplit

from player_backend.classbeat_flow_policy import CALLBACK_PATH
from player_backend.settings import SettingsError

_PREFIX: Final = "PLAYER_CLASSBEAT_"
_SECRET_FILE: Final = _PREFIX + "CLIENT_SECRET_FILE"
_CLIENT_ID: Final = re.compile(r"[\x21-\x7e]{1,255}")
_HOST: Final = re.compile(r"[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?")


@dataclass(frozen=True)
class ClassbeatSettings:
    issuer: str
    client_id: str
    redirect_uri: str
    authorize_url: str
    token_url: str
    keys_url: str
    # Never shown: read from the secret file, sent only to the token endpoint.
    client_secret: str = field(repr=False)

    @classmethod
    def from_env(
        cls, site_origin: str, env: Mapping[str, str] | None = None
    ) -> ClassbeatSettings | None:
        source = os.environ if env is None else env
        if source.get(_PREFIX + "CLIENT_SECRET") is not None:
            raise SettingsError(f"{_PREFIX}CLIENT_SECRET is not read: use {_SECRET_FILE}")
        issuer = source.get(_PREFIX + "ISSUER", "").strip()
        if not issuer:
            if any(key.startswith(_PREFIX) and value.strip() for key, value in source.items()):
                raise SettingsError(f"{_PREFIX}ISSUER is required with any classbeat setting")
            return None
        origin = _https_origin(issuer, "ISSUER")
        client_id = source.get(_PREFIX + "CLIENT_ID", "").strip()
        if _CLIENT_ID.fullmatch(client_id) is None:
            raise SettingsError(f"{_PREFIX}CLIENT_ID is required: printable, at most 255")
        redirect_uri = source.get(_PREFIX + "REDIRECT_URI", "").strip()
        if redirect_uri != site_origin + CALLBACK_PATH:
            raise SettingsError(f"{_PREFIX}REDIRECT_URI must be the site's callback address")
        endpoints = [
            _endpoint(source.get(_PREFIX + name, "").strip(), name, origin)
            for name in ("AUTHORIZE_URL", "TOKEN_URL", "KEYS_URL")
        ]
        secret_file = source.get(_SECRET_FILE, "").strip()
        if not secret_file:
            raise SettingsError(f"{_SECRET_FILE} is required")
        return cls(
            issuer=issuer,
            client_id=client_id,
            redirect_uri=redirect_uri,
            authorize_url=endpoints[0],
            token_url=endpoints[1],
            keys_url=endpoints[2],
            client_secret=read_client_secret(secret_file),
        )


def _https_origin(url: str, name: str) -> str:
    """The `https://host[:port]` of `url`, or a refusal: no user, query or fragment."""
    parts = urlsplit(url)
    if (
        parts.scheme != "https"
        or _HOST.fullmatch(parts.netloc) is None
        or parts.query
        or parts.fragment
        or any(c.isspace() for c in url)
    ):
        raise SettingsError(f"{_PREFIX}{name} must be an https:// address without a query")
    return f"https://{parts.netloc}"


def _endpoint(url: str, name: str, origin: str) -> str:
    if _https_origin(url, name) != origin:
        raise SettingsError(f"{_PREFIX}{name} must be on the issuer's exact origin")
    return url


def read_client_secret(path: str) -> str:
    """The secret in `path`, without its final line break. Never shown in an error."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        raise SettingsError(f"{_SECRET_FILE} cannot be read") from None
    secret = text.removesuffix("\n").removesuffix("\r")
    if not secret or any(not c.isprintable() for c in secret):
        raise SettingsError(f"{_SECRET_FILE} must hold one non-empty line")
    return secret
