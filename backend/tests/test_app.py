"""App factory, settings, health and logging (no database)."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import secrets

import httpx
import pytest
from fastapi import FastAPI

from player_backend.app import create_app
from player_backend.log_redaction import REDACTED, redact
from player_backend.logging_setup import JsonFormatter
from player_backend.settings import Settings, SettingsError

# A fake URL: the password is a placeholder, never a real one.
URL = "postgresql://player_app:placeholder@127.0.0.1:1/none"


def _get(app: FastAPI, path: str, headers: dict[str, str] | None = None) -> httpx.Response:
    async def go() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path, headers=headers)

    return asyncio.run(go())


def _app() -> FastAPI:
    return create_app(Settings.from_env({"PLAYER_DATABASE_URL": URL}))


def _token(kind: str) -> str:
    # Built at run time, so no token-shaped string is in the repository (ADR 0002, section 2).
    secret = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    return "cbp_" + kind + "_" + secret


def test_settings_require_the_database_url() -> None:
    with pytest.raises(SettingsError):
        Settings.from_env({})
    with pytest.raises(SettingsError):
        Settings.from_env({"PLAYER_DATABASE_URL": "mysql://x"})
    with pytest.raises(SettingsError):
        Settings.from_env({"PLAYER_DATABASE_URL": URL, "PLAYER_LOG_LEVEL": "loud"})


def test_settings_never_show_the_database_url() -> None:
    settings = Settings.from_env({"PLAYER_DATABASE_URL": URL})
    assert "placeholder" not in repr(settings)
    with pytest.raises(SettingsError) as raised:
        Settings.from_env({"PLAYER_DATABASE_URL": "mysql://u:hidden@h/d"})
    assert "hidden" not in str(raised.value)


def test_health_answers_without_a_database() -> None:
    response = _get(_app(), "/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_no_api_docs_are_served() -> None:
    app = _app()
    assert _get(app, "/docs").status_code == 404
    assert _get(app, "/openapi.json").status_code == 404


def test_access_log_has_the_path_only(capsys: pytest.CaptureFixture[str]) -> None:
    app = _app()
    token = _token("ses")
    _get(
        app,
        "/healthz?code=" + token,
        headers={"Authorization": "Bearer " + token, "Cookie": "__Host-cbp_session=" + token},
    )
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line]
    access = [line for line in lines if line["logger"] == "player_backend.access"]
    assert access and access[-1]["path"] == "/healthz"
    assert token not in json.dumps(lines)
    assert "Bearer" not in json.dumps(lines)


@pytest.mark.parametrize("kind", ["lgn", "ml", "ses", "dc", "dev", "lc", "src", "hst", "ctl"])
def test_tokens_are_redacted(kind: str) -> None:
    token = _token(kind)
    assert redact("got " + token + " here") == f"got {REDACTED} here"


def test_hashes_codes_and_credential_headers_are_redacted() -> None:
    digest = secrets.token_hex(32)
    assert digest not in redact("hash " + digest)
    assert digest not in redact("bytea \\x" + digest)
    assert "BCDF-GHJK" not in redact("code BCDF-GHJK")
    assert "secret" not in redact("Authorization: Bearer secret")
    assert "secret" not in redact("cookie=secret")


def test_formatter_writes_allowed_fields_only_and_no_exception_text() -> None:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("test.formatter")
    logger.handlers[:] = [handler]
    logger.propagate = False
    token = _token("dev")
    try:
        raise ValueError(token)
    except ValueError:
        logger.exception(
            "failed for %s", token, extra={"fields": {"path": "/x", "authorization": token}}
        )
    entry = json.loads(stream.getvalue())
    assert entry["path"] == "/x" and "authorization" not in entry
    assert entry["exception"] == "ValueError"
    assert token not in stream.getvalue()
