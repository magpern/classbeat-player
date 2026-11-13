"""Export and deletion leave nothing of the account in the logs beyond the access line (method,
path, status, duration) that every request gets (ADR 0002, principle 4 and section 11), and
are counted like every other signed-in request (section 10): a refusal keeps "last used"."""

from __future__ import annotations

import json
import logging

import pytest

from player_backend.logging_setup import configure_logging
from tests.accounthelp import DELETE, EXPORT, full_account
from tests.sitehelp import Site

A = "a@example.test"
FRESH = "SELECT last_used_at > now() - interval '1 minute' FROM player.sessions"


def test_export_and_deletion_log_nothing_of_the_account(
    site: Site, capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture
) -> None:
    a = full_account(site, A, "198.51.100.1", "192.0.2.21")
    configure_logging("DEBUG")
    caplog.set_level(logging.DEBUG)
    capsys.readouterr()
    exported = a.browser.post(EXPORT)
    assert exported.status_code == 200
    assert a.browser.post(DELETE, json={"confirm": "wrong@example.test"}).status_code == 422
    assert a.browser.post(DELETE, json={"confirm": A}).status_code == 204
    captured = capsys.readouterr()
    logged = captured.out + captured.err + caplog.text
    lines = [json.loads(line) for line in captured.out.splitlines() if line.startswith("{")]
    ours = [line for line in lines if line["logger"].startswith("player_backend")]
    # One access line per request, and nothing else from the backend.
    assert [line["logger"] for line in ours] == ["player_backend.access"] * 3
    access = {"time", "level", "logger", "message", "method", "path", "status", "duration_ms"}
    for line in ours:
        assert set(line) == access and line["message"] == "request"
    assert [line["path"] for line in ours] == [EXPORT, DELETE, DELETE]
    for value in (
        A,
        "wrong@example.test",
        "Class of " + A,
        str(a.account_id),
        a.device_token,
        a.source_token,
        *a.session_tokens,
    ):
        assert value not in logged
    assert "Laptop key" not in logged and "a PC" not in logged


@pytest.mark.parametrize(
    ("path", "body"),
    [(EXPORT, None), (DELETE, {"confirm": A})],
)
def test_a_refused_request_keeps_last_used(site: Site, path: str, body: object) -> None:
    a = full_account(site, A, "198.51.100.1", "192.0.2.21")
    site.su.execute(
        "UPDATE player.sessions SET last_used_at = now() - interval '6 minutes', "
        "signed_in_at = now() - interval '11 minutes'"
    )
    answer = a.browser.post(path, json=body)
    assert answer.status_code == 403 and answer.json() == {"error": "recent_sign_in_required"}
    assert (True,) in site.su.execute(FRESH).fetchall()
