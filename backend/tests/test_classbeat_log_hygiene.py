"""No part of a classbeat callback's query, and no secret of the flow, in a log line, an audit
event or a later address (ADR 0010, section 2, step 3, and section 9; #481)."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator, Mapping
from urllib.parse import parse_qs, urlsplit

import pytest

from player_backend.logging_setup import configure_logging
from tests.classbeathelp import CLIENT_SECRET, FakeClassbeat, client
from tests.sitehelp import SESSION_COOKIE, Site, running_site
from tests.test_classbeat_sign_in import BINDING_COOKIE, NAVIGATION, START

EMAIL = "ann@example.test"


class _Recording(FakeClassbeat):
    """The fake, keeping every ID token it signed."""

    def __init__(self) -> None:
        super().__init__(user={"sub": "pairwise-1", "email": EMAIL, "email_verified": True})
        self.tokens: list[str] = []

    def post_token(self, form: Mapping[str, str]) -> bytes:
        answer = super().post_token(form)
        token = json.loads(answer).get("id_token")
        if isinstance(token, str):
            self.tokens.append(token)
        return answer


_CLIENT_LOGGERS = ("httpx", "httpcore")


def _client_line(line: str) -> bool:
    if not line.startswith("{"):
        return False
    return str(json.loads(line).get("logger", "")).startswith(_CLIENT_LOGGERS)


@pytest.fixture
def fake() -> _Recording:
    return _Recording()


@pytest.fixture
def site(app_url: str, db_url: str, fake: _Recording) -> Iterator[Site]:
    with running_site(app_url, db_url, classbeat=client(fake)) as running:
        yield running


def test_no_code_state_nonce_token_or_secret_is_logged(
    site: Site,
    fake: _Recording,
    capsys: pytest.CaptureFixture[str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    site.allow(EMAIL)
    secrets_seen: list[str] = []
    locations: list[str] = []
    callbacks = 0

    def flow(browser_address: str) -> None:
        nonlocal callbacks
        browser = site.browser(browser_address)
        response = browser.post(START, json={"purpose": "sign_in"})
        address = str(response.json()["authorize"])
        query = {k: v[0] for k, v in parse_qs(urlsplit(address).query).items()}
        callback = fake.authorize(address)
        code = parse_qs(urlsplit(callback).query)["code"][0]
        binding = browser.cookies.get(BINDING_COOKIE)
        assert binding is not None
        secrets_seen.extend([query["state"], query["nonce"], code, binding])
        answer = browser.get(callback, headers=NAVIGATION)
        callbacks += 1
        locations.append(answer.headers["location"])
        # A replay, and one that is not a navigation: refusals are logged the same way.
        browser.cookies.set(BINDING_COOKIE, binding, domain="player.test")
        locations.append(browser.get(callback, headers=NAVIGATION).headers["location"])
        not_navigation = {"Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty"}
        locations.append(browser.get(callback, headers=not_navigation).headers["location"])
        callbacks += 2
        session = browser.cookies.get(SESSION_COOKIE)
        if session is not None:
            secrets_seen.append(session)

    flow("203.0.113.7")
    flow("198.51.100.4")
    secrets_seen.extend(fake.tokens)
    secrets_seen.append(CLIENT_SECRET)
    assert fake.tokens

    captured = capsys.readouterr()
    # The test's own client (httpx) logs the addresses it requests; the backend's lines are the
    # rest. Every one of them is searched.
    ours = [r for r in caplog.records if not r.name.startswith(_CLIENT_LOGGERS)]
    out_lines = [line for line in captured.out.splitlines() if not _client_line(line)]
    err_lines = [line for line in captured.err.splitlines() if not _client_line(line)]
    logged = "\n".join(out_lines + err_lines + [r.getMessage() + str(r.__dict__) for r in ours])
    assert out_lines
    for secret in secrets_seen:
        assert secret not in logged
        assert all(secret not in location for location in locations)
    events = site.su.execute("SELECT row_to_json(e)::text FROM player.audit_events e").fetchall()
    for (event,) in events:
        assert all(secret not in str(event) for secret in secrets_seen)
        assert "pairwise-1" not in str(event)
    lines = [json.loads(line) for line in captured.out.splitlines() if line.startswith("{")]
    callback_lines = [
        line
        for line in lines
        if "callback" in json.dumps(line) and line["logger"].endswith("access")
    ]
    assert len(callback_lines) == callbacks
    for line in callback_lines:
        assert "?" not in json.dumps(line) and "code=" not in json.dumps(line)
