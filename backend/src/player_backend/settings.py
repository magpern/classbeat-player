"""Settings read from the environment. No secret has a default (ADR 0002, principle 7)."""

from __future__ import annotations

import ipaddress
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field

from player_backend.client_policy import Network
from player_backend.source_policy import KnownSource, SourcesError, known_source

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR"})
# An origin as a browser sends it: scheme, host and an optional port. HTTPS only, because the
# cookies are `Secure` and `__Host-`.
_ORIGIN = re.compile(r"https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?")


class SettingsError(ValueError):
    """A required setting is missing or a value is not allowed. Never carries the value."""


def _proxies(text: str) -> tuple[Network, ...]:
    try:
        return tuple(
            ipaddress.ip_network(part.strip(), strict=False)
            for part in text.split(",")
            if part.strip()
        )
    except ValueError:
        raise SettingsError(
            "PLAYER_TRUSTED_PROXIES must be addresses or networks separated by commas"
        ) from None


def _sources(text: str) -> tuple[KnownSource, ...]:
    """PLAYER_SOURCES: a JSON list of {"id", "name", "redirect_uris"} (ADR 0002, section 7)."""
    if not text.strip():
        return ()
    try:
        raw = json.loads(text)
    except ValueError:
        raise SettingsError("PLAYER_SOURCES must be a JSON list") from None
    if not isinstance(raw, list):
        raise SettingsError("PLAYER_SOURCES must be a JSON list")
    entries: list[object] = raw  # pyright: ignore[reportUnknownVariableType]
    try:
        found = tuple(known_source(entry) for entry in entries)
    except SourcesError as error:
        raise SettingsError("PLAYER_SOURCES: " + str(error)) from None
    if len({source.id for source in found}) != len(found):
        raise SettingsError("PLAYER_SOURCES: each source id once")
    return found


@dataclass(frozen=True)
class Settings:
    # The running backend's connection, as the role `player_app`. Holds a password: never shown.
    database_url: str = field(repr=False)
    # The site's origin (ADR 0002, sections 4 and 5): what `Origin` must equal, and the start
    # of the link in a sign-in mail. The domain is the owner's, so it has no default.
    site_origin: str
    log_level: str = "INFO"
    # Section 10: the proxy header gives the client address only for requests from these.
    trusted_proxies: tuple[Network, ...] = ()
    # Section 7: the sources that may ask to be linked, with their exact redirect addresses.
    # None by default: no source can be linked until the operator lists one.
    sources: tuple[KnownSource, ...] = ()

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        source = os.environ if env is None else env
        database_url = source.get("PLAYER_DATABASE_URL", "").strip()
        if not database_url:
            raise SettingsError("PLAYER_DATABASE_URL is required")
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise SettingsError("PLAYER_DATABASE_URL must be a postgresql:// URL")
        site_origin = source.get("PLAYER_SITE_ORIGIN", "").strip()
        if not site_origin:
            raise SettingsError("PLAYER_SITE_ORIGIN is required")
        if _ORIGIN.fullmatch(site_origin) is None:
            raise SettingsError("PLAYER_SITE_ORIGIN must be an origin like https://host")
        log_level = source.get("PLAYER_LOG_LEVEL", "INFO").strip().upper()
        if log_level not in _LOG_LEVELS:
            raise SettingsError("PLAYER_LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR")
        return cls(
            database_url=database_url,
            site_origin=site_origin,
            log_level=log_level,
            trusted_proxies=_proxies(source.get("PLAYER_TRUSTED_PROXIES", "")),
            sources=_sources(source.get("PLAYER_SOURCES", "")),
        )
