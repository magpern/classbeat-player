"""No device code, user code, device token or hash in a log line, an audit event, a mail or a
URL (ADR 0002, principles 3 and 4, section 11), over a whole pairing, refusals included."""

from __future__ import annotations

import json
import logging
from typing import Any

import pytest

from player_backend.code_policy import code_hash, normalise_code
from player_backend.logging_setup import configure_logging
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash
from tests import pairhelp
from tests.pairhelp import DECIDE, DEVICE, DEVICES, FIND, START, TOKEN, bearer
from tests.sitehelp import Browser, Site

EMAIL = "rider@example.test"


def _flow(site: Site, browser: Browser) -> tuple[list[str], list[str], list[str]]:
    """Run the flows. Returns (long tokens in play, user codes in play, URLs requested)."""
    urls: list[str] = []

    def call(
        client: Browser, method: str, path: str, json: object = None, token: str | None = None
    ) -> Any:
        headers = None if token is None else bearer(token)
        response = client.request(method, path, json=json, headers=headers)
        urls.append(str(response.request.url))
        return response.json() if response.content else {}

    app = pairhelp.app_client(site)
    started = call(app, "POST", START, {"platform": "linux", "version": "1.0"})
    device_code, user_code = str(started["device_code"]), str(started["user_code"])
    denied = call(app, "POST", START, {"platform": "linux", "version": "1.0"})
    call(app, "POST", TOKEN, {"device_code": device_code})  # pending
    call(app, "POST", TOKEN, {"device_code": device_code})  # too soon
    call(browser, "POST", FIND, {"code": "BCDF-GHJK"})  # a wrong code
    call(browser, "POST", FIND, {"code": user_code})
    call(browser, "POST", DECIDE, {"code": user_code, "approve": True, "name": "Studio PC"})
    call(browser, "POST", DECIDE, {"code": denied["user_code"], "approve": False})
    call(browser, "POST", DECIDE, {"code": user_code, "approve": True, "name": "Again"})  # used
    pairhelp.wait_for_next_poll(site)
    collected = call(app, "POST", TOKEN, {"device_code": device_code})
    device_token = str(collected["device_token"])
    call(app, "POST", TOKEN, {"device_code": device_code})  # used up
    call(app, "POST", TOKEN, {"device_code": str(denied["device_code"])})  # denied
    call(app, "POST", TOKEN, {"device_code": 5})  # bad input
    call(app, "GET", DEVICE, token=device_token)
    unknown = new_token("dev")
    call(app, "GET", DEVICE, token=unknown)
    listed = call(browser, "GET", DEVICES)
    device_id = str(listed["devices"][0]["id"])
    call(browser, "DELETE", f"{DEVICES}/{device_id}")
    call(app, "GET", DEVICE, token=device_token)  # revoked: the header is still sent
    call(app, "DELETE", DEVICE, token=device_token)
    tokens = [device_code, str(denied["device_code"]), device_token, unknown]
    return tokens, [user_code, str(denied["user_code"])], urls


def test_no_code_token_or_hash_reaches_a_log_an_event_a_mail_or_a_url(
    site: Site, capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    # Bind the app's log handler to the output this test captures, at the most talkative level.
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    capsys.readouterr()
    tokens, codes, urls = _flow(site, browser)
    captured = capsys.readouterr()
    logged = captured.out + captured.err + caplog.text
    lines = [json.loads(line) for line in captured.out.splitlines() if line.startswith("{")]
    assert len([line for line in lines if line["logger"] == "player_backend.access"]) == len(urls)

    events = site.su.execute("SELECT row_to_json(e)::text FROM player.audit_events e").fetchall()
    names = {json.loads(str(row[0]))["event"] for row in events}
    assert {"pairing.approved", "pairing.denied", "device.created", "device.revoked"} <= names
    stored = " ".join(str(row[0]) for row in events)
    mails = " ".join(mail.subject + " " + mail.body for mail in site.mailer.sent[1:])
    assert "A new device was paired" in mails
    places = (logged, stored, mails, " ".join(urls))
    for token in tokens:
        secret = token.split("_", 2)[2]  # the 43 characters after the type
        assert len(secret) == 43
        for text in places:
            assert token not in text and secret not in text
            assert token_hash(token).hex() not in text.lower()
    for shown in codes:
        code = normalise_code(shown)
        assert code is not None
        for text in places:
            assert shown not in text and code not in text
            assert code_hash(code).hex() not in text.lower()
    assert "Bearer" not in logged and EMAIL not in logged
    assert all("?" not in url and "#" not in url for url in urls)
