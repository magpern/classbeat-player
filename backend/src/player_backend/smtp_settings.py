"""The SMTP settings, read from the environment, and the password from a file (issue #83).

No setting has a default that sends mail: without `PLAYER_SMTP_HOST` there is no mail service
and the app keeps `NoMailer`. The password is read only from the file named by
`PLAYER_SMTP_PASSWORD_FILE` (a deploy's secret mount), never from a variable that holds it.
No error carries a value or the file's content.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Literal

from player_backend.settings import SettingsError

type TlsMode = Literal["implicit", "starttls"]

_PREFIX: Final = "PLAYER_SMTP_"
_DEFAULT_PORTS: Final[Mapping[TlsMode, int]] = {"implicit": 465, "starttls": 587}
_HOST = re.compile(r"[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?")
_ADDRESS = re.compile(r"[^@\s<>\"(),;:\\]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?")
_USER = re.compile(r"[^\s]{1,254}")


@dataclass(frozen=True)
class SmtpSettings:
    host: str
    port: int
    tls: TlsMode
    sender: str
    # The name this side gives in EHLO. Fixed, so that no lookup of the local host is made.
    helo_name: str = "localhost"
    user: str | None = None
    # Never shown: read from the secret file, held for the logins.
    password: str | None = field(default=None, repr=False)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> SmtpSettings | None:
        """The settings, or None when no SMTP host is set (and no other SMTP setting is)."""
        source = os.environ if env is None else env
        if source.get(_PREFIX + "PASSWORD") is not None:
            raise SettingsError("PLAYER_SMTP_PASSWORD is not read: use PLAYER_SMTP_PASSWORD_FILE")
        host = source.get(_PREFIX + "HOST", "").strip()
        if not host:
            if any(key.startswith(_PREFIX) and value.strip() for key, value in source.items()):
                raise SettingsError("PLAYER_SMTP_HOST is required when an SMTP setting is given")
            return None
        if len(host) > 253 or _HOST.fullmatch(host) is None:
            raise SettingsError("PLAYER_SMTP_HOST must be a host name")
        tls = _tls_mode(source.get(_PREFIX + "TLS", "implicit"))
        sender = source.get(_PREFIX + "FROM", "").strip()
        if len(sender) > 254 or _ADDRESS.fullmatch(sender) is None:
            raise SettingsError("PLAYER_SMTP_FROM must be a plain address like name@host")
        helo_name = source.get(_PREFIX + "HELO_NAME", "localhost").strip()
        if len(helo_name) > 253 or _HOST.fullmatch(helo_name) is None:
            raise SettingsError("PLAYER_SMTP_HELO_NAME must be a host name")
        user = source.get(_PREFIX + "USER", "").strip() or None
        password_file = source.get(_PREFIX + "PASSWORD_FILE", "").strip()
        if user is not None and _USER.fullmatch(user) is None:
            raise SettingsError("PLAYER_SMTP_USER must be one word of at most 254 characters")
        if (user is None) != (not password_file):
            raise SettingsError("PLAYER_SMTP_USER and PLAYER_SMTP_PASSWORD_FILE go together")
        return cls(
            host=host,
            port=_port(source.get(_PREFIX + "PORT", ""), tls),
            tls=tls,
            sender=sender,
            helo_name=helo_name,
            user=user,
            password=read_secret_file(password_file) if password_file else None,
        )


def _tls_mode(raw: str) -> TlsMode:
    value = raw.strip().lower()
    if value == "implicit":
        return "implicit"
    if value == "starttls":
        return "starttls"
    raise SettingsError("PLAYER_SMTP_TLS must be implicit or starttls")


def _port(raw: str, tls: TlsMode) -> int:
    text = raw.strip()
    if not text:
        return _DEFAULT_PORTS[tls]
    if not text.isdigit() or not 1 <= int(text) <= 65535:
        raise SettingsError("PLAYER_SMTP_PORT must be a port number")
    return int(text)


def read_secret_file(path: str) -> str:
    """The secret in `path`, without its final line break. Never shown in an error."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        raise SettingsError("PLAYER_SMTP_PASSWORD_FILE cannot be read") from None
    secret = text.removesuffix("\n").removesuffix("\r")
    if not secret or any(c in secret for c in "\r\n\0"):
        raise SettingsError("PLAYER_SMTP_PASSWORD_FILE must hold one non-empty line")
    return secret
