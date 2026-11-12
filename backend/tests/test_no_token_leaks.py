"""No token, hash or mail body in a log line, an audit event or a URL (ADR 0002, principles 3
and 4, section 11), over a whole sign-in and sign-out, refusals included."""

from __future__ import annotations

import json
import logging

import pytest

from player_backend.logging_setup import configure_logging
from player_backend.login_policy import sign_in_mail
from player_backend.no_mailer import NoMailer
from player_backend.token_issue import new_token
from player_backend.token_policy import token_hash
from tests.sitehelp import LOGIN_COOKIE, SESSION_COOKIE, Browser, Site, link_token

EMAIL = "rider@example.test"


def _flow(site: Site) -> tuple[list[str], list[str]]:
    """Run the flows. Returns (every token that was in play, every URL that was requested)."""
    urls: list[str] = []

    def call(browser: Browser, method: str, path: str, json: object = None) -> None:
        response = browser.request(method, path, json=json)
        urls.append(str(response.request.url))

    site.allow(EMAIL)
    browser, other = site.browser(), site.browser("198.51.100.3")
    call(browser, "POST", "/api/site/sign-in/link", json={"email": EMAIL})
    link = link_token(site.mailer.sent[-1])
    call(other, "POST", "/api/site/sign-in/complete", json={"token": link})  # the wrong browser
    call(browser, "POST", "/api/site/sign-in/complete", json={"token": link})
    call(browser, "POST", "/api/site/sign-in/complete", json={"token": link})  # reuse
    call(browser, "POST", "/api/site/sign-in/link", json={"email": EMAIL})  # an account now
    second = link_token(site.mailer.sent[-1])
    call(browser, "GET", "/api/site/sessions")
    call(browser, "POST", "/api/site/sign-in/complete", json={"token": 5})  # bad input
    session = browser.cookies.get(SESSION_COOKIE)
    login = browser.cookies.get(LOGIN_COOKIE)
    assert session is not None and login is not None
    call(browser, "POST", "/api/site/sessions/end-all")
    call(browser, "GET", "/api/site/sessions")  # 401: the cookie is still sent
    return [link, second, session, login], urls


def test_no_token_or_hash_reaches_a_log_an_event_or_a_url(
    site: Site, capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    # Bind the app's log handler to the output this test captures, at the most talkative level.
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    tokens, urls = _flow(site)
    captured = capsys.readouterr()
    logged = captured.out + captured.err + caplog.text
    lines = [json.loads(line) for line in captured.out.splitlines() if line.startswith("{")]
    assert len([line for line in lines if line["logger"] == "player_backend.access"]) == len(urls)

    events = site.su.execute("SELECT row_to_json(e)::text FROM player.audit_events e").fetchall()
    assert len(events) >= 3
    stored = " ".join(str(row[0]) for row in events)
    for token in tokens:
        digest = token_hash(token)
        secret = token.split("_", 2)[2]  # the 43 characters after the type
        assert len(secret) == 43
        for text in (logged, stored, " ".join(urls)):
            assert token not in text
            assert secret not in text
            assert digest.hex() not in text.lower()
    assert "sign-in#" not in logged and "Bearer" not in logged
    assert EMAIL not in logged


def test_the_mail_holds_the_token_in_the_fragment_and_is_never_shown(site: Site) -> None:
    site.allow(EMAIL)
    token = site.ask(site.first, EMAIL)
    assert token is not None
    (mail,) = site.mailer.sent
    # The fragment is never sent to a server; nothing of the token is before it.
    address = next(word for word in mail.body.split() if word.startswith("https://"))
    assert address.index("#") < address.index(token) and "?" not in address
    assert token not in repr(mail) and token not in mail.subject


def test_the_mailer_without_a_mail_service_logs_nothing_of_the_mail(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging("INFO")
    token = new_token("ml")
    NoMailer().send(sign_in_mail("https://player.test", EMAIL, token))
    out = capsys.readouterr().out
    assert "mail.not_configured" in out
    assert token not in out and EMAIL not in out and "sign-in" not in out
