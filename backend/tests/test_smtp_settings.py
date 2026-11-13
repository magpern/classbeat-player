"""SMTP settings (smtp_settings.py): the password from a file only, never in an error or a repr,
and no SMTP host means the app keeps `NoMailer`."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import player_backend.app as app_module
from player_backend.app import create_app
from player_backend.no_mailer import NoMailer
from player_backend.settings import Settings, SettingsError
from player_backend.smtp_mailer import SmtpMailer, mailer_from_env
from player_backend.smtp_settings import SmtpSettings

SECRET = "s3cret-from-the-file"


@pytest.fixture
def password_file(tmp_path: Path) -> Path:
    path = tmp_path / "smtp_password"
    path.write_text(SECRET + "\n", encoding="utf-8")
    return path


def _env(password_file: Path, **more: str) -> dict[str, str]:
    return {
        "PLAYER_SMTP_HOST": "smtp.example.test",
        "PLAYER_SMTP_FROM": "noreply@player.example.test",
        "PLAYER_SMTP_USER": "mailer",
        "PLAYER_SMTP_PASSWORD_FILE": str(password_file),
        **more,
    }


def test_no_host_no_mailer() -> None:
    assert SmtpSettings.from_env({}) is None
    assert mailer_from_env({"PLAYER_LOG_LEVEL": "INFO"}) is None


def test_create_app_keeps_no_mailer_without_one(monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[str] = []

    class NoPool:
        def close(self) -> None:
            pass

    def open_pool(url: str) -> NoPool:
        opened.append(url)
        return NoPool()

    monkeypatch.setattr(app_module, "open_pool", open_pool)
    settings = Settings(database_url="postgresql://unused", site_origin="https://p.example.test")
    # No re-check loop: it would open its own connection to the unused database.
    app = create_app(settings, mailer_from_env({}), live_recheck=None)
    with TestClient(app):
        assert isinstance(app.state.site.mailer, NoMailer)
    assert opened == ["postgresql://unused"]


def test_the_password_comes_from_the_file(password_file: Path) -> None:
    settings = SmtpSettings.from_env(_env(password_file))
    assert settings is not None
    assert settings.password == SECRET
    assert (settings.port, settings.tls, settings.helo_name) == (465, "implicit", "localhost")
    assert SECRET not in repr(settings)
    assert isinstance(mailer_from_env(_env(password_file)), SmtpMailer)


def test_starttls_defaults_to_587(password_file: Path) -> None:
    settings = SmtpSettings.from_env(_env(password_file, PLAYER_SMTP_TLS="STARTTLS"))
    assert settings is not None and (settings.port, settings.tls) == (587, "starttls")


def test_a_password_in_a_variable_is_refused(password_file: Path) -> None:
    with pytest.raises(SettingsError, match="PASSWORD_FILE") as raised:
        SmtpSettings.from_env(_env(password_file, PLAYER_SMTP_PASSWORD=SECRET))
    assert SECRET not in str(raised.value)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"PLAYER_SMTP_HOST": ""}, "PLAYER_SMTP_HOST is required"),
        ({"PLAYER_SMTP_HOST": "smtp.example.test/x"}, "PLAYER_SMTP_HOST"),
        ({"PLAYER_SMTP_TLS": "none"}, "PLAYER_SMTP_TLS"),
        ({"PLAYER_SMTP_PORT": "0"}, "PLAYER_SMTP_PORT"),
        ({"PLAYER_SMTP_PORT": "smtp"}, "PLAYER_SMTP_PORT"),
        ({"PLAYER_SMTP_FROM": ""}, "PLAYER_SMTP_FROM"),
        ({"PLAYER_SMTP_FROM": "a@b.test\r\nBcc: c@d.test"}, "PLAYER_SMTP_FROM"),
        ({"PLAYER_SMTP_FROM": "Name <a@b.test>"}, "PLAYER_SMTP_FROM"),
        ({"PLAYER_SMTP_USER": ""}, "go together"),
        ({"PLAYER_SMTP_PASSWORD_FILE": ""}, "go together"),
        ({"PLAYER_SMTP_PASSWORD_FILE": "/nonexistent/smtp_password"}, "cannot be read"),
        ({"PLAYER_SMTP_HELO_NAME": "bad name"}, "PLAYER_SMTP_HELO_NAME"),
    ],
)
def test_bad_settings_are_refused_without_their_values(
    password_file: Path, change: dict[str, str], message: str
) -> None:
    with pytest.raises(SettingsError, match=message) as raised:
        SmtpSettings.from_env(_env(password_file, **change))
    text = str(raised.value)
    assert SECRET not in text and "nonexistent" not in text and "Bcc" not in text
    error = raised.value
    assert error.__cause__ is None and (error.__context__ is None or error.__suppress_context__)


@pytest.mark.parametrize("content", ["", "\n", "two\nlines\n", "nul\0inside"])
def test_a_password_file_must_hold_one_line(tmp_path: Path, content: str) -> None:
    path = tmp_path / "smtp_password"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(SettingsError, match="one non-empty line") as raised:
        SmtpSettings.from_env(_env(path))
    assert content.strip() == "" or content.split("\n")[0] not in str(raised.value)


def test_no_user_means_no_password(tmp_path: Path) -> None:
    env = {"PLAYER_SMTP_HOST": "relay.example.test", "PLAYER_SMTP_FROM": "n@p.example.test"}
    settings = SmtpSettings.from_env(env)
    assert settings is not None and settings.user is None and settings.password is None
