"""No challenge, credential id, public key, signature or their hashes in a log line, an audit
event or a URL (ADR 0002, principles 3 and 4, section 11), over registering, signing in,
renaming and removing passkeys, refusals included."""

from __future__ import annotations

import base64
import json
import logging

import pytest

from player_backend.logging_setup import configure_logging
from player_backend.passkey_policy import challenge_hash
from tests.passkeyhelp import (
    OPTIONS,
    PASSKEYS,
    SIGN_IN,
    SIGN_IN_OPTIONS,
    Authenticator,
    b64,
    options_of,
    unb64,
)
from tests.sitehelp import Browser, Site

EMAIL = "rider@example.test"


def _forms(data: bytes) -> list[str]:
    """The ways a value could be written: base64url, base64, hex, and its hash in hex."""
    return [
        b64(data),
        base64.b64encode(data).decode().rstrip("="),
        data.hex(),
        challenge_hash(data).hex(),
    ]


def _flow(site: Site, browser: Browser) -> tuple[list[bytes], list[str]]:
    """Run the flows. Returns (secret values in play, URLs requested)."""
    urls: list[str] = []
    values: list[bytes] = []

    def call(client: Browser, method: str, path: str, body: object = None) -> object:
        response = client.request(method, path, json=body)
        urls.append(str(response.request.url))
        return response.json() if response.content else {}

    def answered(answer: dict[str, object]) -> dict[str, object]:
        response = answer["response"]
        assert isinstance(response, dict)
        for key in ("clientDataJSON", "signature", "attestationObject"):
            if key in response:
                values.append(unb64(str(response[key])))  # pyright: ignore[reportUnknownArgumentType]
        return answer

    good, bad = Authenticator(), Authenticator("ES384")
    for authenticator in (good, bad):
        options = call(browser, "POST", OPTIONS)
        assert isinstance(options, dict)
        values.append(unb64(str(options["challenge"])))  # pyright: ignore[reportUnknownArgumentType]
        credential = answered(authenticator.create(options))  # pyright: ignore[reportUnknownArgumentType]
        call(browser, "POST", PASSKEYS, {"name": "Laptop", "credential": credential})
        values += [authenticator.credential_id, authenticator.cose_key()]
    other = site.browser()
    for answer in (
        {},
        {"rp_id": "evil.test"},
        {"counter": 0},
        {"credential_id": bad.credential_id},
    ):
        asked = other.post(SIGN_IN_OPTIONS)
        urls.append(str(asked.request.url))
        options = options_of(asked)
        values.append(unb64(str(options["challenge"])))
        credential = answered(good.get(options, **answer))  # pyright: ignore[reportArgumentType]
        call(other, "POST", SIGN_IN, {"credential": credential})
        call(other, "POST", SIGN_IN, {"credential": credential})  # a replay
    listed = call(browser, "GET", PASSKEYS)
    assert isinstance(listed, dict)
    passkey_id = str(listed["passkeys"][0]["id"])  # pyright: ignore[reportUnknownArgumentType, reportIndexIssue]
    call(browser, "PATCH", f"{PASSKEYS}/{passkey_id}", {"name": "Desk"})
    call(browser, "DELETE", f"{PASSKEYS}/{passkey_id}")
    return values, urls


def test_no_challenge_credential_key_or_signature_reaches_a_log_an_event_or_a_url(
    site: Site, capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    # Bind the app's log handler to the output this test captures, at the most talkative level.
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    capsys.readouterr()
    values, urls = _flow(site, browser)
    captured = capsys.readouterr()
    logged = captured.out + captured.err + caplog.text
    assert "player_backend.access" in logged

    events = site.su.execute("SELECT row_to_json(e)::text FROM player.audit_events e").fetchall()
    names = {json.loads(str(row[0]))["event"] for row in events}
    assert {
        "passkey.added",
        "passkey.removed",
        "passkey.counter_refused",
        "login.refused",
        "login.signed_in",
    } <= names
    stored = " ".join(str(row[0]) for row in events)
    for text in (logged, stored, " ".join(urls)):
        for value in values:
            for form in _forms(value):
                assert form not in text
    assert all("?" not in url and "#" not in url for url in urls)
