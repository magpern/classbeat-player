"""The limits of `POST /api/live/controller` on the test database (ADR 0005, section 10, amended
2026-11-13; ADR 0002, section 10). The live service's clock is the test's.

- a call without a valid site session is `cannot_control` before any join code is looked up,
  and counts for the address; past 60 a minute the address is refused without a session, but a
  signed-in call from it still gets a controller; the minute ends;
- a signed-in call with an unknown join code (or one of another account's session) counts for
  the account; past 60 a minute the account is refused even with a right code, from any
  address; the minute ends;
- both places held counts against neither limit, nor does `controllers_full` on `/control`;
- the sign-in route neither counts against nor is refused by the per-address limit of
  `/control`;
- every refusal is the same answer, so none tells whether a join code exists.
"""

from __future__ import annotations

from ipaddress import ip_address
from typing import cast

import httpx
import pytest

from player_backend.client_policy import address_hash
from player_backend.code_policy import ALPHABET
from player_backend.live.service import LiveService
from tests import pairhelp
from tests.pairhelp import bearer
from tests.sitehelp import ADDRESS, Browser, Site

LIVE = "/api/live/sessions"
CONTROLLER = "/api/live/controller"
CONTROL = "/api/live/control"
HOST = "host@example.test"
OTHER = "other@example.test"
ELSEWHERE = "198.51.100.9"


class Clock:
    def __init__(self) -> None:
        # A whole number of seconds, so that a minute later is exactly 60.0 later.
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _service(site: Site) -> LiveService:
    return cast(LiveService, site.app.state.live)


@pytest.fixture
def clock(site: Site) -> Clock:
    clock = Clock()
    _service(site).clock = clock
    return clock


def _hosting(site: Site, email: str = HOST) -> tuple[Browser, dict[str, str]]:
    site.allow(email)
    browser = site.sign_in(email)
    app = pairhelp.app_client(site)
    token = pairhelp.pair(site, browser, "Studio PC", app)
    answer = app.post(LIVE, headers=bearer(token))
    assert answer.status_code == 200, answer.text
    return browser, cast(dict[str, str], answer.json())


def _ask(browser: Browser, join: str) -> httpx.Response:
    return browser.post(CONTROLLER, json={"session": join})


def _cannot(answer: httpx.Response) -> None:
    assert (answer.status_code, answer.json()) == (403, {"error": "cannot_control"})


def _unknown(join: str) -> str:
    return ALPHABET[(ALPHABET.index(join[0]) + 1) % len(ALPHABET)] + join[1:]


def _code(site: Site, live: dict[str, str]) -> str:
    service = _service(site)
    session_id = service.registry.session_of_code(live["joinCode"])
    assert session_id is not None
    made = service.registry.make_code(session_id, service.clock())
    assert made is not None
    return made.code


def _same(answer: httpx.Response) -> tuple[int, bytes]:
    _cannot(answer)
    return answer.status_code, answer.content


def test_without_a_session_nothing_is_looked_up_and_the_address_is_counted(
    site: Site, clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser, live = _hosting(site)
    service = _service(site)
    looked_up: list[object] = []
    session_of_code = service.registry.session_of_code

    def spy(raw: object) -> object:
        looked_up.append(raw)
        return session_of_code(raw)

    monkeypatch.setattr(service.registry, "session_of_code", spy)
    key = address_hash(ip_address(ADDRESS))
    stale = site.browser()
    stale.take_cookies(browser)
    signed_out = site.sign_in(HOST)
    ended = site.browser()  # holds a cookie whose site session has ended
    ended.take_cookies(signed_out)
    assert signed_out.post("/api/site/sign-out").status_code == 204
    for i in range(60):
        assert not service.signed_out_refused(key)
        _cannot(_ask(ended if i % 2 else site.browser(), live["joinCode"]))
    assert looked_up == []
    assert service.signed_out_refused(key)
    # Past the limit a call with no cookie is refused by the gate, before the sign-in is
    # looked up (so it is not counted again); one with a cookie is still looked up.
    counted: list[bytes] = []
    monkeypatch.setattr(service, "signed_out", counted.append)
    _cannot(_ask(site.browser(), live["joinCode"]))
    assert counted == []
    _cannot(_ask(ended, live["joinCode"]))
    assert counted == [key]
    # Another address is not held back, and a signed-in call from this one gets through.
    assert not service.signed_out_refused(address_hash(ip_address(ELSEWHERE)))
    assert _ask(stale, live["joinCode"]).status_code == 200
    assert looked_up == [live["joinCode"]]
    # The signed-out calls counted nothing for the account or for `/control`'s address limit.
    assert service.refused_for(key) is None
    clock.now += 60.0
    assert not service.signed_out_refused(key)


def test_unknown_codes_count_for_the_account(site: Site, clock: Clock) -> None:
    browser, live = _hosting(site)
    join = live["joinCode"]
    for _ in range(60):
        _cannot(_ask(browser, _unknown(join)))
    # Over the limit: refused even with the right code, and from another address too.
    _cannot(_ask(browser, join))
    elsewhere = site.browser(ELSEWHERE)
    elsewhere.take_cookies(browser)
    _cannot(_ask(elsewhere, join))
    # No 429 and nothing on the address: `/control` and its per-address limit are untouched.
    service = _service(site)
    assert service.refused_for(address_hash(ip_address(ADDRESS))) is None
    phone = site.browser()
    answer = phone.post(CONTROL, json={"session": join, "code": _code(site, live)})
    assert answer.status_code == 200, answer.text
    # Another account is not held back.
    site.allow(OTHER)
    other = site.sign_in(OTHER)
    assert _ask(other, _unknown(join)).status_code == 403
    clock.now += 60.0
    assert _ask(browser, join).status_code == 200


def test_another_accounts_code_counts_as_unknown_and_answers_the_same(
    site: Site, clock: Clock
) -> None:
    _, theirs = _hosting(site, OTHER)
    browser, live = _hosting(site)
    join = live["joinCode"]
    seen = {_same(_ask(browser, theirs["joinCode"])) for _ in range(30)}
    seen |= {_same(_ask(browser, _unknown(join))) for _ in range(30)}
    assert len(seen) == 1  # the same answer whether a code exists or not
    _cannot(_ask(browser, join))
    clock.now += 60.0
    assert _ask(browser, join).status_code == 200


def test_both_places_held_counts_against_neither_limit(site: Site, clock: Clock) -> None:
    browser, live = _hosting(site)
    join = live["joinCode"]
    service = _service(site)
    for _ in range(2):
        assert _ask(browser, join).status_code == 200
    full = {_same(_ask(browser, join)) for _ in range(70)}
    assert full == {_same(_ask(browser, _unknown(join)))}
    session_id = service.registry.session_of_code(join)
    assert session_id is not None and service.registry.host_drop(session_id, 1)
    assert _ask(browser, join).status_code == 200  # the account was never refused
    # `controllers_full` on `/control` is not a wrong try and does not count the address.
    code = _code(site, live)
    phone = site.browser()
    for _ in range(70):
        answer = phone.post(CONTROL, json={"session": join, "code": code})
        assert (answer.status_code, answer.json()) == (409, {"error": "controllers_full"})
    assert service.refused_for(address_hash(ip_address(ADDRESS))) is None
    assert not service.signed_out_refused(address_hash(ip_address(ADDRESS)))


def test_an_address_over_the_control_limit_still_signs_in(site: Site, clock: Clock) -> None:
    """A rider on the studio's shared address cannot lock the instructor out: the address
    refused by `/control`'s per-address limit is not refused on the sign-in route."""
    browser, live = _hosting(site)
    join = live["joinCode"]
    phone = site.browser()  # the same address as the instructor's browser
    for _ in range(60):
        answer = phone.post(CONTROL, json={"session": _unknown(join), "code": "BCDF-GHJK"})
        assert (answer.status_code, answer.json()) == (403, {"error": "invalid_code"})
    limited = phone.post(CONTROL, json={"session": join, "code": _code(site, live)})
    assert (limited.status_code, limited.json()) == (429, {"error": "too_many_requests"})
    assert _service(site).refused_for(address_hash(ip_address(ADDRESS))) is not None
    assert _ask(browser, join).status_code == 200
