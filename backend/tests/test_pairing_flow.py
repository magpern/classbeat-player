"""Pairing a device through the API (ADR 0002, section 6): start, look up, decide, poll; the
limits of section 10; the events of section 11; and the mail about a new device."""

from __future__ import annotations

import re

import pytest

from player_backend.client_policy import ClientInfo
from player_backend.db import pairing as pairing_access
from player_backend.db.executor import Pool
from player_backend.player_api import pairing as pairing_routes
from player_backend.token_issue import new_token
from player_backend.token_policy import is_token
from tests import pairhelp
from tests.pairhelp import DECIDE, DEVICES, FIND, START, TOKEN
from tests.sitehelp import ORIGIN, Browser, Site

EMAIL = "rider@example.test"
WRONG = "BCDF-GHJK"


def _signed_in(site: Site, email: str = EMAIL) -> Browser:
    site.allow(email)
    return site.sign_in(email)


def _pairings(site: Site) -> list[tuple[object, ...]]:
    return site.su.execute("SELECT state, device_name FROM player.pairings").fetchall()


def test_start_returns_the_codes_and_puts_none_in_an_address(site: Site) -> None:
    response = pairhelp.app_client(site).post(START, json={"platform": "linux", "version": "1.0"})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {"device_code", "user_code", "verification_uri", "expires_in", "interval"}
    assert is_token("dc", body["device_code"])
    assert re.fullmatch(r"[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}", body["user_code"])
    assert (body["expires_in"], body["interval"]) == (600, 5)
    # The page the app opens carries no code: the user types it.
    assert body["verification_uri"] == ORIGIN + "/pair"
    # Stored as hashes only.
    stored = site.su.execute("SELECT p::text FROM player.pairings p").fetchone()
    assert stored is not None
    assert body["device_code"] not in str(stored[0])
    assert body["user_code"].replace("-", "") not in str(stored[0])


@pytest.mark.parametrize(
    "body",
    [
        {"platform": "", "version": "1.0"},
        {"platform": "linux", "version": "‮\u0000"},
        {"platform": "x" * 41, "version": "1.0"},
        {"platform": "linux"},
        {"platform": 5, "version": "1.0"},
    ],
)
def test_a_start_without_a_platform_and_version_is_refused(site: Site, body: object) -> None:
    response = pairhelp.app_client(site).post(START, json=body)
    assert response.status_code == 422 and response.json() == {"error": "invalid_request"}
    assert _pairings(site) == []


def test_the_whole_pairing_gives_the_token_once_with_the_accounts_email(site: Site) -> None:
    browser = _signed_in(site)
    pairing = pairhelp.start(site, platform="windows")
    assert pairhelp.poll(pairing).json() == {"error": "authorization_pending"}
    # Input ignores case, spaces and hyphens.
    typed = " " + pairing.user_code.lower().replace("-", " - ")
    found = browser.post(FIND, json={"code": typed})
    assert found.status_code == 200
    assert found.json() == {"platform": "windows", "version": "1.0"}
    assert _pairings(site) == [("pending", None)]
    # Control characters are removed from the name; it is stored as text.
    decided = pairhelp.approve(browser, pairing, "  Studio\u0000 PC‮ ")
    assert decided.status_code == 200 and decided.json() == {"status": "approved"}
    assert _pairings(site) == [("approved", "Studio PC")]
    assert site.su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)

    pairhelp.wait_for_next_poll(site)
    sent_before = len(site.mailer.sent)
    collected = pairhelp.poll(pairing)
    assert collected.status_code == 200
    assert collected.headers["cache-control"] == "no-store"
    body = collected.json()
    assert set(body) == {"device_token", "email"} and body["email"] == EMAIL
    assert is_token("dev", body["device_token"])
    # The clear token is not stored, and the pairing is used up.
    stored = site.su.execute("SELECT d::text FROM player.devices d").fetchall()
    assert len(stored) == 1 and body["device_token"] not in str(stored[0][0])
    assert _pairings(site) == []
    for _ in range(2):
        again = pairhelp.poll(pairing)
        assert again.status_code == 400 and again.json() == {"error": "expired_token"}
    assert site.su.execute("SELECT count(*) FROM player.devices").fetchone() == (1,)
    # The user code is used up too.
    assert browser.post(FIND, json={"code": pairing.user_code}).status_code == 404

    # The account is told by mail, which holds neither the token nor a code.
    (mail,) = site.mailer.sent[sent_before:]
    assert mail.to == EMAIL and mail.subject == "A new device was paired"
    assert "cbp_" not in mail.body and pairing.user_code not in mail.body
    assert [event for event, _ in site.events(EMAIL)][-2:] == ["pairing.approved", "device.created"]
    # It works as a device token, and the site lists the device.
    assert (
        pairing.app.get(pairhelp.DEVICE, headers=pairhelp.bearer(body["device_token"])).status_code
        == 200
    )
    listed = browser.get(DEVICES).json()["devices"]
    assert [(d["name"], d["platform"]) for d in listed] == [("Studio PC", "windows")]


def test_a_poll_before_the_interval_gets_slow_down_and_no_token(site: Site) -> None:
    browser = _signed_in(site)
    pairing = pairhelp.start(site)
    assert pairhelp.poll(pairing).json() == {"error": "authorization_pending"}
    assert pairhelp.approve(browser, pairing).status_code == 200
    hasty = pairhelp.poll(pairing)
    assert hasty.status_code == 400 and hasty.json() == {"error": "slow_down"}
    assert site.su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)
    pairhelp.wait_for_next_poll(site)
    assert pairhelp.poll(pairing).status_code == 200


def test_a_denied_pairing_gives_access_denied_and_no_device(site: Site) -> None:
    browser = _signed_in(site)
    pairing = pairhelp.start(site)
    denied = pairhelp.deny(browser, pairing)
    assert denied.status_code == 200 and denied.json() == {"status": "denied"}
    for _ in range(2):
        answer = pairhelp.poll(pairing)
        assert answer.status_code == 400 and answer.json() == {"error": "access_denied"}
        pairhelp.wait_for_next_poll(site)
    # A denied code cannot be approved afterwards.
    assert pairhelp.approve(browser, pairing).status_code == 404
    assert site.su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)
    assert site.mailer.sent[-1].subject != "A new device was paired"
    assert site.events(EMAIL)[-1][0] == "pairing.denied"


def test_a_pairing_ends_after_ten_minutes(site: Site) -> None:
    browser = _signed_in(site)
    pairing = pairhelp.start(site)
    assert pairhelp.approve(browser, pairing).status_code == 200
    site.su.execute("UPDATE player.pairings SET expires_at = now(), last_polled_at = NULL")
    ended = pairhelp.poll(pairing)
    assert ended.status_code == 400 and ended.json() == {"error": "expired_token"}
    other = pairhelp.start(site)
    site.su.execute("UPDATE player.pairings SET expires_at = now()")
    assert browser.post(FIND, json={"code": other.user_code}).status_code == 404
    assert pairhelp.approve(browser, other).status_code == 404
    assert site.su.execute("SELECT count(*) FROM player.devices").fetchone() == (0,)


def test_what_is_not_a_device_code_is_refused_before_any_lookup(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    lookups: list[bytes] = []
    collect = pairing_access.collect

    def counted(
        pool: Pool, *, device_code_hash: bytes, device_token_hash: bytes, client: ClientInfo
    ) -> tuple[object, object]:
        lookups.append(device_code_hash)
        return collect(
            pool,
            device_code_hash=device_code_hash,
            device_token_hash=device_token_hash,
            client=client,
        )

    monkeypatch.setattr(pairing_access, "collect", counted)
    app = pairhelp.app_client(site)
    for value in ("", "x", new_token("dev"), new_token("ses"), new_token("dc") + "A", "BCDF-GHJK"):
        refused = app.post(TOKEN, json={"device_code": value})
        assert refused.status_code == 400 and refused.json() == {"error": "expired_token"}
    assert app.post(TOKEN, json={"device_code": 5}).status_code == 422
    assert lookups == []
    unknown = app.post(TOKEN, json={"device_code": new_token("dc")})
    assert unknown.status_code == 400 and unknown.json() == {"error": "expired_token"}
    assert len(lookups) == 1


def test_five_wrong_codes_close_the_form_for_the_account_only(site: Site) -> None:
    browser = _signed_in(site)
    other = _signed_in(site, "other@example.test")
    pairing = pairhelp.start(site)
    pairhelp.settle(site, 900)
    # What is not a short code at all is not compared and not counted.
    for typed in ("", "ABCD-EFGH", "BCDF-GHJ", "1234-5678"):
        malformed = browser.post(FIND, json={"code": typed})
        assert malformed.status_code == 422 and malformed.json() == {"error": "invalid_code"}
    for path, extra in ((FIND, {}), (DECIDE, {"approve": True, "name": "x"}), (FIND, {})):
        wrong = browser.post(path, json={"code": WRONG, **extra})
        assert wrong.status_code == 404 and wrong.json() == {"error": "pairing_not_found"}
    assert browser.post(FIND, json={"code": pairing.user_code}).status_code == 200
    for path, extra in ((DECIDE, {"approve": False}), (FIND, {})):
        assert browser.post(path, json={"code": WRONG, **extra}).status_code == 404
    # Closed: the right code is now answered like a wrong one, at both calls.
    assert browser.post(FIND, json={"code": pairing.user_code}).status_code == 404
    assert pairhelp.approve(browser, pairing).status_code == 404
    assert _pairings(site) == [("pending", None)]
    # Another account is not held back by it.
    assert other.post(FIND, json={"code": pairing.user_code}).status_code == 200
    # Fifteen minutes later the form is open again.
    site.su.execute("UPDATE player.rate_limits SET expires_at = now(), hits = 0")
    assert pairhelp.approve(browser, pairing).status_code == 200


def test_ten_pairing_starts_an_hour_per_address(site: Site) -> None:
    app = pairhelp.app_client(site)
    pairhelp.settle(site, 3600)
    for _ in range(10):
        pairhelp.start(site, app)
    limited = app.post(START, json={"platform": "linux", "version": "1.0"})
    assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    assert 1 <= int(limited.headers["retry-after"]) <= 3600
    assert site.su.execute("SELECT count(*) FROM player.pairings").fetchone() == (10,)
    # Per address: another one may start.
    pairhelp.start(site, pairhelp.app_client(site, "198.51.100.9"))


def test_an_eleventh_device_is_refused(site: Site) -> None:
    browser = _signed_in(site)
    for number in range(10):
        site.su.execute("DELETE FROM player.rate_limits")
        pairhelp.pair(site, browser, f"Device {number}")
    site.su.execute("DELETE FROM player.rate_limits")
    pairing = pairhelp.start(site)
    refused = pairhelp.approve(browser, pairing, "Eleventh")
    assert refused.status_code == 409 and refused.json() == {"error": "too_many_devices"}
    assert _pairings(site) == [("pending", None)]
    # A denial is still possible, and after revoking one device an approval is too.
    first = browser.get(DEVICES).json()["devices"][0]["id"]
    assert browser.delete(f"{DEVICES}/{first}").status_code == 204
    assert pairhelp.approve(browser, pairing, "Eleventh").status_code == 200


@pytest.mark.parametrize("name", [None, "", "  \u0000 ", "n" * 41])
def test_an_approval_needs_a_name_of_1_to_40_characters(site: Site, name: object) -> None:
    browser = _signed_in(site)
    pairing = pairhelp.start(site)
    body = {"code": pairing.user_code, "approve": True, "name": name}
    refused = browser.post(DECIDE, json=body)
    assert refused.status_code == 422 and refused.json() == {"error": "invalid_name"}
    assert _pairings(site) == [("pending", None)]


def test_looking_up_and_deciding_need_a_signed_in_same_origin_request(site: Site) -> None:
    browser = _signed_in(site)
    pairing = pairhelp.start(site)
    code = {"code": pairing.user_code}
    stranger = site.browser()
    for path, body in ((FIND, code), (DECIDE, {**code, "approve": True, "name": "x"})):
        assert stranger.post(path, json=body).status_code == 401
        cross = browser.post(path, json=body, headers={"Origin": "https://evil.test"})
        assert cross.status_code == 403 and cross.json() == {"error": "cross_site_request"}
    # The device code decides nothing, and the app cannot approve its own pairing.
    app_try = pairing.app.post(DECIDE, json={**code, "approve": True, "name": "x"})
    assert app_try.status_code == 403
    assert _pairings(site) == [("pending", None)]


def test_a_code_that_is_in_use_is_replaced_by_a_new_one(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = pairhelp.start(site)
    codes = iter([first.user_code.replace("-", ""), "ZZZZXXXX"])
    monkeypatch.setattr(pairing_routes, "new_code", lambda: next(codes))
    second = pairhelp.start(site)
    assert second.user_code == "ZZZZ-XXXX"
    assert site.su.execute("SELECT count(*) FROM player.pairings").fetchone() == (2,)
