"""The settings of sign-in with classbeat (ADR 0010, sections 2 and 3; #481).

The client secret is read from its file only; no error holds a value or the file's content.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from player_backend.classbeat_settings import ClassbeatSettings
from player_backend.settings import SettingsError

SITE = "https://player.test"
SECRET = "file-secret-value-123"  # noqa: S105 (made up here)


def _env(tmp_path: Path, **changes: str | None) -> dict[str, str]:
    secret_file = tmp_path / "classbeat_client_secret"
    secret_file.write_text(SECRET + "\n", encoding="utf-8")
    env = {
        "PLAYER_CLASSBEAT_ISSUER": "https://classbeat.test",
        "PLAYER_CLASSBEAT_CLIENT_ID": "player",
        "PLAYER_CLASSBEAT_REDIRECT_URI": SITE + "/api/site/sign-in/classbeat/callback",
        "PLAYER_CLASSBEAT_AUTHORIZE_URL": "https://classbeat.test/oauth/authorize",
        "PLAYER_CLASSBEAT_TOKEN_URL": "https://classbeat.test/oauth/token",
        "PLAYER_CLASSBEAT_KEYS_URL": "https://classbeat.test/oauth/jwks",
        "PLAYER_CLASSBEAT_CLIENT_SECRET_FILE": str(secret_file),
    }
    for name, value in changes.items():
        key = "PLAYER_CLASSBEAT_" + name
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    return env


def test_the_settings_are_read_and_the_secret_comes_from_its_file(tmp_path: Path) -> None:
    settings = ClassbeatSettings.from_env(SITE, _env(tmp_path))
    assert settings is not None
    assert settings.client_secret == SECRET
    assert settings.token_url == "https://classbeat.test/oauth/token"
    assert SECRET not in repr(settings)


def test_without_an_issuer_there_is_no_classbeat_sign_in() -> None:
    assert ClassbeatSettings.from_env(SITE, {}) is None
    assert ClassbeatSettings.from_env(SITE, {"PLAYER_CLASSBEAT_ISSUER": " "}) is None


def test_a_setting_without_the_issuer_is_refused(tmp_path: Path) -> None:
    with pytest.raises(SettingsError):
        ClassbeatSettings.from_env(SITE, _env(tmp_path, ISSUER=None))


def test_a_secret_in_a_variable_is_refused_and_not_shown(tmp_path: Path) -> None:
    with pytest.raises(SettingsError) as refused:
        ClassbeatSettings.from_env(SITE, _env(tmp_path, CLIENT_SECRET="leaked-value"))
    assert "leaked-value" not in str(refused.value)


@pytest.mark.parametrize(
    "changes",
    [
        {"ISSUER": "http://classbeat.test"},
        {"ISSUER": "https://user@classbeat.test"},
        {"ISSUER": "https://classbeat.test?x=1"},
        {"TOKEN_URL": "https://other.test/oauth/token"},
        {"TOKEN_URL": "http://classbeat.test/oauth/token"},
        {"KEYS_URL": "https://classbeat.test:8443/oauth/jwks"},
        {"AUTHORIZE_URL": "https://classbeat.test.evil.test/oauth/authorize"},
        {"AUTHORIZE_URL": None},
        {"REDIRECT_URI": "https://player.test/elsewhere"},
        {"REDIRECT_URI": "https://other.test/api/site/sign-in/classbeat/callback"},
        {"CLIENT_ID": ""},
        {"CLIENT_ID": "has space"},
        {"CLIENT_SECRET_FILE": None},
    ],
)
def test_a_wrong_setting_stops_the_start(tmp_path: Path, changes: dict[str, str | None]) -> None:
    with pytest.raises(SettingsError):
        ClassbeatSettings.from_env(SITE, _env(tmp_path, **changes))


@pytest.mark.parametrize("content", ["", "\n", "two\nlines\n", "tab\tin"])
def test_a_secret_file_that_is_not_one_line_is_refused_and_not_shown(
    tmp_path: Path, content: str
) -> None:
    env = _env(tmp_path)
    Path(env["PLAYER_CLASSBEAT_CLIENT_SECRET_FILE"]).write_text(content, encoding="utf-8")
    with pytest.raises(SettingsError) as refused:
        ClassbeatSettings.from_env(SITE, env)
    assert "lines" not in str(refused.value) and "tab" not in str(refused.value)


def test_a_missing_secret_file_is_refused(tmp_path: Path) -> None:
    env = _env(tmp_path, CLIENT_SECRET_FILE=str(tmp_path / "missing"))
    with pytest.raises(SettingsError) as refused:
        ClassbeatSettings.from_env(SITE, env)
    assert str(tmp_path) not in str(refused.value)
