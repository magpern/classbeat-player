"""No link code, source token or hash in a log line, an audit event or a requested URL (ADR 0002,
principles 3 and 4, section 11), over linking a source, publishing and revoking, refusals
included. No class title in an event either."""

from __future__ import annotations

import json
import logging

import pytest

from player_backend.logging_setup import configure_logging
from player_backend.token_policy import token_hash
from tests import sourcehelp as sh
from tests.sitehelp import Site

EMAIL = "teacher@example.test"
TITLE = "A title only the class holds"


def test_no_code_token_hash_or_title_reaches_a_log_an_event_or_a_url(
    site: Site, capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    app = sh.server(site)
    urls: list[str] = []

    verifier, challenge = sh.pkce()
    approved = sh.approve(browser, challenge)
    code = sh.code_of(approved)
    urls.append(str(approved.request.url))
    wrong = sh.exchange(app, code, "w" * 43)  # uses the code up
    urls.append(str(wrong.request.url))
    verifier, challenge = sh.pkce()
    second = sh.code_of(sh.approve(browser, challenge))
    linked = sh.exchange(app, second, verifier)
    token = str(linked.json()["source_token"])
    doc = sh.document(TITLE)
    for body in (
        sh.envelope("c1", 2, doc),
        sh.envelope("c1", 2, doc),
        sh.envelope("c1", 1, doc),
        sh.envelope("c1", 3, None),
    ):
        urls.append(str(sh.publish(app, token, body).request.url))
    urls.append(str(app.get(f"{sh.CLASSES}/c1", headers=sh.bearer(token)).request.url))
    urls.append(str(app.delete(sh.OWN_LINK, headers=sh.bearer(token)).request.url))
    urls.append(str(sh.publish(app, token, sh.envelope("c1", 4, None)).request.url))

    captured = capsys.readouterr()
    logged = captured.out + captured.err + caplog.text
    events = site.su.execute("SELECT row_to_json(e)::text FROM player.audit_events e").fetchall()
    stored = " ".join(str(row[0]) for row in events)
    assert "source.linked" in stored and "publication.stale" in stored
    for secret in (code, second, token, verifier):
        for text in (logged, stored, " ".join(urls)):
            assert secret not in text
            assert token_hash(secret).hex() not in text.lower()
    assert sh.envelope("c1", 2, doc)["content_hash"] not in stored + logged
    assert TITLE not in stored and TITLE not in logged
    assert "Bearer" not in logged
    # Every line of the access log is method, path and status only.
    access = [json.loads(line) for line in captured.out.splitlines() if line.startswith("{")]
    assert all("query" not in str(line) for line in access)
