"""`POST /api/live/sessions` and the end of a session, on the test database (ADR 0002, sections
8 and 11; ADR 0005, sections 2 and 4).

The app starts a session with its device token and gets the contract's `session-answer`; one
session per device; 3 per account (409 `sessions_full`); every other credential is refused like
the player API refuses it. "Live session started" and "ended" are the account's audit events,
with no token, code or hash in them; an end after the device was revoked writes nothing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import httpx
from jsonschema import Draft202012Validator

from player_backend.live.service import LiveService
from player_backend.token_issue import new_token
from tests import pairhelp
from tests.pairhelp import DEVICES, bearer
from tests.sitehelp import Browser, Site

SCHEMA = Path(__file__).resolve().parents[2] / "schema" / "live" / "v1"
EMAIL = "rider@example.test"
LIVE = "/api/live/sessions"


def _valid(name: str, answer: httpx.Response, status: int) -> Any:
    assert answer.status_code == status, answer.text
    schema = json.loads((SCHEMA / f"{name}.schema.json").read_text(encoding="utf-8"))
    body = answer.json()
    errors = [e.message for e in Draft202012Validator(schema).iter_errors(body)]  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    assert errors == [], errors
    assert answer.headers["cache-control"] == "no-store"
    return body


def _service(site: Site) -> LiveService:
    return cast(LiveService, site.app.state.live)


def _paired(site: Site, *names: str) -> tuple[Browser, Browser, list[str]]:
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    app = pairhelp.app_client(site)
    return browser, app, [pairhelp.pair(site, browser, name, app) for name in names]


def _live_events(site: Site) -> list[tuple[str, dict[str, str]]]:
    return [
        (event, cast(dict[str, str], detail))
        for event, detail in site.events(EMAIL)
        if event.startswith("live.")
    ]


def test_the_app_starts_a_session_with_its_device_token(site: Site) -> None:
    _, app, (token,) = _paired(site, "Studio PC")
    body = _valid("session-answer", app.post(LIVE, headers=bearer(token)), 200)
    service = _service(site)
    session_id = service.registry.host_session(body["hostToken"], service.clock())
    assert session_id is not None and str(session_id) == body["sessionId"]
    assert service.registry.session_of_code(body["joinCode"]) == session_id
    assert _live_events(site) == [("live.session_started", {"session_id": body["sessionId"]})]
    row = site.su.execute(
        "SELECT credential_kind, client_network::text FROM player.audit_events "
        "WHERE event = 'live.session_started'"
    ).fetchone()
    assert row == ("device", "203.0.113.0/24")


def test_a_new_session_of_the_device_ends_the_earlier_one(site: Site) -> None:
    _, app, (token,) = _paired(site, "Studio PC")
    first = app.post(LIVE, headers=bearer(token)).json()
    second = app.post(LIVE, headers=bearer(token)).json()
    registry = _service(site).registry
    assert registry.host_session(first["hostToken"], 0.0) is None
    assert registry.session_of_code(first["joinCode"]) is None
    assert [str(r.session_id) for r in registry.running()] == [second["sessionId"]]
    assert _live_events(site) == [
        ("live.session_started", {"session_id": first["sessionId"]}),
        ("live.session_ended", {"session_id": first["sessionId"], "reason": "replaced"}),
        ("live.session_started", {"session_id": second["sessionId"]}),
    ]


def test_three_sessions_per_account_then_sessions_full(site: Site) -> None:
    _, app, tokens = _paired(site, "One", "Two", "Three", "Four")
    for token in tokens[:3]:
        assert app.post(LIVE, headers=bearer(token)).status_code == 200
    before = _live_events(site)
    refused = _valid("error", app.post(LIVE, headers=bearer(tokens[3])), 409)
    assert refused == {"error": "sessions_full"}
    assert _live_events(site) == before and len(_service(site).registry.running()) == 3
    # A device of the three may start again: it replaces its own.
    assert app.post(LIVE, headers=bearer(tokens[0])).status_code == 200
    assert len(_service(site).registry.running()) == 3


def test_every_other_credential_is_refused_before_a_session(site: Site) -> None:
    browser, app, (token,) = _paired(site, "Studio PC")
    cases: list[tuple[dict[str, str], str]] = [
        ({}, "invalid_token"),
        (bearer(new_token("hst")), "invalid_token"),
        (bearer(new_token("ctl")), "invalid_token"),
        (bearer(new_token("rdr")), "invalid_token"),
        (bearer(new_token("ses")), "invalid_token"),
        (bearer(new_token("dev")), "token_unknown"),
    ]
    for headers, code in cases:
        assert _valid("error", app.post(LIVE, headers=headers), 401) == {"error": code}
    # The site's session cookie is no credential here.
    assert _valid("error", browser.post(LIVE), 401) == {"error": "invalid_token"}
    device_id = browser.get(DEVICES).json()["devices"][0]["id"]
    assert browser.delete(f"{DEVICES}/{device_id}").status_code == 204
    revoked = _valid("error", app.post(LIVE, headers=bearer(token)), 401)
    assert revoked == {"error": "token_revoked"}
    assert _service(site).registry.running() == [] and _live_events(site) == []


def test_an_end_is_recorded_after_the_device_is_entered(site: Site) -> None:
    _, app, (token,) = _paired(site, "Studio PC")
    body = app.post(LIVE, headers=bearer(token)).json()
    service = _service(site)
    session_id = service.registry.host_session(body["hostToken"], service.clock())
    assert session_id is not None
    assert service.end(session_id, "host_ended")
    assert not service.end(session_id, "host_ended")
    assert _live_events(site)[-1] == (
        "live.session_ended",
        {"session_id": body["sessionId"], "reason": "host_ended"},
    )
    row = site.su.execute(
        "SELECT credential_kind, client_network FROM player.audit_events "
        "WHERE event = 'live.session_ended'"
    ).fetchone()
    assert row == ("device", None)


def test_an_end_after_the_device_is_revoked_writes_nothing(site: Site) -> None:
    browser, app, (token,) = _paired(site, "Studio PC")
    body = app.post(LIVE, headers=bearer(token)).json()
    service = _service(site)
    session_id = service.registry.host_session(body["hostToken"], service.clock())
    assert session_id is not None
    site.su.execute("UPDATE player.devices SET revoked_at = now()")
    # The host's end, or an end by a lifetime: the device no longer sets the account.
    assert service.end(session_id, "lifetime")
    assert _live_events(site) == [("live.session_started", {"session_id": body["sessionId"]})]
    assert browser.get(DEVICES).status_code == 200


def test_no_event_holds_a_token_code_or_hash(site: Site) -> None:
    _, app, (token,) = _paired(site, "Studio PC")
    bodies = [app.post(LIVE, headers=bearer(token)).json() for _ in range(2)]
    service = _service(site)
    for running in service.registry.running():
        service.end(running.session_id, "host_ended")
    stored = str(site.su.execute("SELECT detail::text FROM player.audit_events").fetchall())
    for body in bodies:
        assert body["hostToken"] not in stored and body["joinCode"] not in stored
        assert body["joinCode"].replace("-", "") not in stored
    assert token not in stored
    for _, detail in _live_events(site):
        assert set(detail) <= {"session_id", "reason"}
