"""Settings read from the environment. No secret has a default (ADR 0002, principle 7)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR"})


class SettingsError(ValueError):
    """A required setting is missing or a value is not allowed. Never carries the value."""


@dataclass(frozen=True)
class Settings:
    # The running backend's connection, as the role `player_app`. Holds a password: never shown.
    database_url: str = field(repr=False)
    log_level: str = "INFO"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        source = os.environ if env is None else env
        database_url = source.get("PLAYER_DATABASE_URL", "").strip()
        if not database_url:
            raise SettingsError("PLAYER_DATABASE_URL is required")
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise SettingsError("PLAYER_DATABASE_URL must be a postgresql:// URL")
        log_level = source.get("PLAYER_LOG_LEVEL", "INFO").strip().upper()
        if log_level not in _LOG_LEVELS:
            raise SettingsError("PLAYER_LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR")
        return cls(database_url=database_url, log_level=log_level)
