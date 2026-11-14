"""The controller routes on the test database (ADR 0002, sections 5, 8, 10 and 11; ADR 0005,
sections 3 and 4).

- `POST /api/live/controller`: the host account's sign-in and the join code give a controller
  token (the contract's `controller-answer`, `no-store`) and "controller added" (`sign_in`) in
  the site session's transaction; every refusal is 403 `cannot_control`: no sign-in, an ended
  one, another origin, another account, an unknown session, both places held (its limits are in
  tests/test_live_controller_limits.py); the end of the site session drops the controller at
  the re-check; a grant whose site session transaction fails at its commit holds no place; a
  grant whose answer fails to send after the commit still holds its place, and the host's
  `drop` frees it;
- `POST /api/live/control`: "controller added" (`code`) and "control code cancelled" after
  wrong tries are written after `auth_enter_device` with the session's stored hash, and nothing
  once the device is revoked.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import httpx
from jsonschema import Draft202012Validator
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from player_backend.code_policy import ALPHABET
from player_backend.live.events import MadeCode
from player_backend.live.service import LiveService
from tests import pairhelp
from tests.pairhelp import bearer
from tests.sitehelp import ADDRESS, ORIGIN, SAME_ORIGIN, Browser, Site

SCHEMA = Path(__file__).resolve().parents[2] / "schema" / "live" / "v1"
EMAIL = "host@example.test"
OTHER = "other@example.test"
LIVE = "/api/live/sessions"
CONTROLLER = "/api/live/controller"
CONTROL = "/api/live/control"


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


def _hosting(site: Site) -> tuple[Browser, dict[str, str]]:
    """A signed-in browser of the host account, and its app's live session."""
    site.allow(EMAIL)
    browser = site.sign_in(EMAIL)
    app = pairhelp.app_client(site)
    token = pairhelp.pair(site, browser, "Studio PC", app)
    answer = app.post(LIVE, headers=bearer(token))
    assert answer.status_code == 200, answer.text
    return browser, cast(dict[str, str], answer.json())


def _ask(browser: Browser, join: str, headers: dict[str, str] | None = None) -> httpx.Response:
    return browser.post(CONTROLLER, json={"session": join}, headers=headers)


def _cannot(answer: httpx.Response) -> None:
    assert _valid("error", answer, 403) == {"error": "cannot_control"}


def _live_events(site: Site, email: str = EMAIL) -> list[tuple[str, dict[str, str]]]:
    return [
        (event, cast(dict[str, str], detail))
        for event, detail in site.events(email)
        if event.startswith("live.") and event != "live.session_started"
    ]


def test_the_host_accounts_sign_in_gets_a_controller(site: Site) -> None:
    browser, live = _hosting(site)
    body = _valid("controller-answer", _ask(browser, live["joinCode"]), 200)
    service = _service(site)
    seat = service.registry.controller_seat(body["controllerToken"], service.clock())
    assert seat is not None and (str(seat.session_id), seat.slot, seat.via) == (
        live["sessionId"],
        1,
        "sign_in",
    )
    added = {"session_id": live["sessionId"], "via": "sign_in"}
    assert _live_events(site) == [("live.controller_added", added)]
    row = site.su.execute(
        "SELECT credential_kind FROM player.audit_events WHERE event = 'live.controller_added'"
    ).fetchone()
    assert row == ("session",)
    # The page sends the join code as the contract writes it; anything else is malformed.
    assert _ask(browser, live["joinCode"].lower()).status_code == 422


def test_at_most_two_controllers_by_sign_in(site: Site) -> None:
    browser, live = _hosting(site)
    for _ in range(2):
        assert _ask(browser, live["joinCode"]).status_code == 200
    _cannot(_ask(browser, live["joinCode"]))
    assert len(_service(site).registry.signed_in_controllers()) == 2
    assert [e for e, _ in _live_events(site)] == ["live.controller_added"] * 2


def test_every_refusal_is_cannot_control(site: Site) -> None:
    browser, live = _hosting(site)
    join = live["joinCode"]
    _cannot(_ask(site.browser(), join))  # no sign-in
    _cannot(_ask(browser, join, {"origin": "https://evil.example"}))
    _cannot(_ask(browser, join, {"sec-fetch-site": "cross-site"}))
    site.allow(OTHER)
    _cannot(_ask(site.sign_in(OTHER), join))  # another account
    stale = site.browser()
    stale.take_cookies(browser)
    assert browser.post("/api/site/sign-out").status_code == 204
    _cannot(_ask(stale, join))  # an ended sign-in
    assert _service(site).registry.signed_in_controllers() == []
    assert _live_events(site) == [] and _live_events(site, OTHER) == []


def test_a_malformed_body_is_invalid_request(site: Site) -> None:
    browser, live = _hosting(site)
    for body in ({}, {"session": live["joinCode"], "code": "BCDF-GHJK"}, {"session": 12}):
        answer = browser.post(CONTROLLER, json=body)
        assert _valid("error", answer, 422) == {"error": "invalid_request"}
    answer = browser.post(CONTROLLER, content=json.dumps({"session": live["joinCode"]}).encode())
    assert answer.status_code == 422  # not sent as JSON


def _unknown(join: str) -> str:
    return ALPHABET[(ALPHABET.index(join[0]) + 1) % len(ALPHABET)] + join[1:]


def test_the_end_of_the_sign_in_drops_the_controller_at_the_recheck(site: Site) -> None:
    browser, live = _hosting(site)
    assert _ask(browser, live["joinCode"]).status_code == 200
    service = _service(site)
    assert service.recheck() and len(service.registry.signed_in_controllers()) == 1
    assert browser.post("/api/site/sign-out").status_code == 204
    assert service.recheck()
    assert service.registry.signed_in_controllers() == []


# Fails the transaction at its commit, as a deferred check does, once "controller added" is in it.
_FAIL_AT_COMMIT = (
    "CREATE FUNCTION public.test_fail_at_commit() RETURNS trigger LANGUAGE plpgsql AS "
    "$$ BEGIN RAISE EXCEPTION 'failed at commit'; END $$",
    "CREATE CONSTRAINT TRIGGER test_fail_at_commit AFTER INSERT ON player.audit_events "
    "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.event = 'live.controller_added') "
    "EXECUTE FUNCTION public.test_fail_at_commit()",
)
_NO_FAIL_AT_COMMIT = (
    "DROP TRIGGER IF EXISTS test_fail_at_commit ON player.audit_events",
    "DROP FUNCTION IF EXISTS public.test_fail_at_commit()",
)


def test_a_sign_in_whose_commit_fails_holds_no_place(site: Site) -> None:
    browser, live = _hosting(site)
    failing = site.browser(raise_errors=False)
    failing.take_cookies(browser)
    try:
        for statement in _FAIL_AT_COMMIT:
            site.su.execute(statement)
        for _ in range(3):  # more than the 2 places: none is left held
            assert _ask(failing, live["joinCode"]).status_code == 500
    finally:
        for statement in _NO_FAIL_AT_COMMIT:
            site.su.execute(statement)
    service = _service(site)
    assert service.registry.signed_in_controllers() == []
    assert _live_events(site) == []
    # Both places are free for the next sign-ins.
    for slot in (1, 2):
        body = _valid("controller-answer", _ask(browser, live["joinCode"]), 200)
        seat = service.registry.controller_seat(body["controllerToken"], service.clock())
        assert seat is not None and seat.slot == slot


def _code(site: Site, live: dict[str, str]) -> str:
    service = _service(site)
    session_id = service.registry.session_of_code(live["joinCode"])
    assert session_id is not None
    made = service.registry.make_code(session_id, service.clock())
    assert isinstance(made, MadeCode)
    return made.code


def test_a_controller_by_code_and_a_cancelled_code_are_audited(site: Site) -> None:
    _, live = _hosting(site)
    phone = site.browser("198.51.100.4", headers={"origin": ORIGIN})
    code = _code(site, live)
    answer = phone.post(CONTROL, json={"session": live["joinCode"], "code": code})
    _valid("controller-answer", answer, 200)
    code = _code(site, live)
    wrong = _unknown(code)
    for _ in range(5):
        answer = phone.post(CONTROL, json={"session": live["joinCode"], "code": wrong})
        assert _valid("error", answer, 403) == {"error": "invalid_code"}
    assert _live_events(site) == [
        ("live.controller_added", {"session_id": live["sessionId"], "via": "code"}),
        ("live.control_code_cancelled", {"session_id": live["sessionId"], "reason": "wrong_tries"}),
    ]
    rows = site.su.execute(
        "SELECT credential_kind, client_network::text FROM player.audit_events "
        "WHERE event LIKE 'live.co%' ORDER BY occurred_at"
    ).fetchall()
    assert rows == [("device", "198.51.100.0/24")] * 2


def test_nothing_is_written_once_the_device_is_revoked(site: Site) -> None:
    _, live = _hosting(site)
    code = _code(site, live)
    site.su.execute("UPDATE player.devices SET revoked_at = now()")
    phone = site.browser("198.51.100.4")
    answer = phone.post(CONTROL, json={"session": live["joinCode"], "code": code})
    assert answer.status_code == 200  # the re-check ends the session; the event is not written
    assert _live_events(site) == []


def _answer_never_sent(app: ASGIApp) -> ASGIApp:
    """The app, with the answer to `POST /api/live/controller` failing as it is sent (a client
    gone), after the route has returned and its site session's transaction has committed."""

    async def wrapped(scope: Scope, receive: Receive, send: Send) -> None:
        async def failing(message: Message) -> None:
            if scope.get("path") == CONTROLLER and message["type"] == "http.response.start":
                raise OSError("the client is gone")
            await send(message)

        await app(scope, receive, failing)

    return wrapped


def test_a_place_held_when_the_answer_fails_after_the_commit_is_freed_by_drop(
    site: Site,
) -> None:
    browser, live = _hosting(site)
    gone = Browser(cast(Any, _answer_never_sent(site.app)), site.loop, ADDRESS, SAME_ORIGIN, False)
    gone.take_cookies(browser)
    assert _ask(gone, live["joinCode"]).status_code == 500  # no answer reached the phone
    # The commit came first: "controller added" is written and the place stays held.
    added = {"session_id": live["sessionId"], "via": "sign_in"}
    assert _live_events(site) == [("live.controller_added", added)]
    registry = _service(site).registry
    held = registry.signed_in_controllers()
    assert [(str(c.session_id), c.slot) for c in held] == [(live["sessionId"], 1)]
    # The host drops it, and both places are free for the next sign-ins.
    assert registry.host_drop(held[0].session_id, held[0].slot)
    assert registry.signed_in_controllers() == []
    for slot in (1, 2):
        body = _valid("controller-answer", _ask(browser, live["joinCode"]), 200)
        seat = registry.controller_seat(body["controllerToken"], _service(site).clock())
        assert seat is not None and seat.slot == slot
