"""The device token through the API (ADR 0002, sections 3, 6, 10 and 11): its one scope, its
headers, the answers when it does not work, revoking, and the limits on bearer tokens."""

from __future__ import annotations

from contextlib import AbstractContextManager

import pytest

from player_backend.db import devices
from player_backend.db.context import AccountContext
from player_backend.db.executor import Pool
from player_backend.token_issue import new_token
from tests import pairhelp
from tests.pairhelp import DEVICE, DEVICES, bearer
from tests.sitehelp import SESSION_COOKIE, Browser, Site

EMAIL = "rider@example.test"
SESSIONS = "/api/site/sessions"


def _signed_in(site: Site, email: str = EMAIL) -> Browser:
    site.allow(email)
    return site.sign_in(email)


def _lookups(monkeypatch: pytest.MonkeyPatch) -> list[bytes]:
    """Every call of `devices.entered`: the lookups of device tokens."""
    seen: list[bytes] = []
    entered = devices.entered

    def counted(
        pool: Pool, token_hash: bytes, keys: devices.BearerKeys
    ) -> AbstractContextManager[AccountContext | devices.Refused]:
        seen.append(token_hash)
        return entered(pool, token_hash, keys)

    monkeypatch.setattr(devices, "entered", counted)
    return seen


def _refused(app: Browser, token: str, error: str) -> None:
    response = app.get(DEVICE, headers=bearer(token))
    assert response.status_code == 401 and response.json() == {"error": error}
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["cache-control"] == "no-store"


def test_a_device_token_reads_its_own_device_and_nothing_else(site: Site) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser, "Studio PC")
    pairhelp.pair(site, browser, "Other PC")
    app = pairhelp.app_client(site)
    response = app.get(DEVICE, headers=bearer(token))
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    device = response.json()["device"]
    assert set(device) == {"name", "platform", "version", "paired_at"}
    assert (device["name"], device["platform"], device["version"]) == ("Studio PC", "linux", "1.0")
    # Nothing of the account, of its other device or of any hash is in the answer.
    assert EMAIL not in response.text and "Other PC" not in response.text
    # Use is recorded: the site shows which device was used, and which never was.
    listed = {d["name"]: d["last_used_at"] for d in browser.get(DEVICES).json()["devices"]}
    assert listed["Studio PC"] is not None and listed["Other PC"] is None


def test_the_player_api_takes_a_device_token_as_a_bearer_token_and_nothing_else(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    session = browser.cookies.get(SESSION_COOKIE)
    assert session is not None
    seen = _lookups(monkeypatch)
    app = pairhelp.app_client(site)
    wrong = (
        "Bearer " + session,  # a token of another type
        "Bearer " + new_token("dc"),
        "Bearer " + token + "A",
        "Bearer " + token.replace("cbp_dev_", "cbp_DEV_"),
        "Bearer  " + token,
        "Basic " + token,
        token,
        "",
    )
    for value in wrong:
        refused = app.get(DEVICE, headers={"Authorization": value})
        assert refused.status_code == 401 and refused.json() == {"error": "invalid_token"}
        assert refused.headers["www-authenticate"] == "Bearer"
    assert app.get(DEVICE).status_code == 401
    # The session cookie is not looked at here: a signed-in browser is refused like anyone.
    assert browser.get(DEVICE).status_code == 401
    assert browser.delete(DEVICE).status_code == 401
    # All refused by shape, before any lookup.
    assert seen == []
    assert app.get(DEVICE, headers=bearer(token)).status_code == 200
    assert len(seen) == 1


def test_a_device_token_does_not_reach_the_sites_api(site: Site) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    app = pairhelp.app_client(site)
    for path in (SESSIONS, DEVICES):
        assert app.get(path, headers=bearer(token)).status_code == 401
    as_cookie = site.browser()
    as_cookie.cookies.set(SESSION_COOKIE, token, domain="player.test")
    assert as_cookie.get(SESSIONS).status_code == 401
    assert as_cookie.get(DEVICES).status_code == 401
    device_id = browser.get(DEVICES).json()["devices"][0]["id"]
    assert as_cookie.delete(f"{DEVICES}/{device_id}").status_code == 401
    assert pairhelp.device_rows(site, EMAIL) == [("Studio PC", False, False)]


def test_revoking_on_the_site_takes_effect_with_the_next_request(site: Site) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    kept = pairhelp.pair(site, browser, "Kept")
    app = pairhelp.app_client(site)
    assert app.get(DEVICE, headers=bearer(token)).status_code == 200
    listed = browser.get(DEVICES).json()["devices"]
    device_id = next(d["id"] for d in listed if d["name"] == "Studio PC")
    assert browser.delete(f"{DEVICES}/{device_id}").status_code == 204
    _refused(app, token, "token_revoked")
    assert app.get(DEVICE, headers=bearer(kept)).status_code == 200
    # The row is kept, to answer `token_revoked`; the site no longer lists it.
    assert pairhelp.device_rows(site, EMAIL) == [("Kept", True, False), ("Studio PC", True, True)]
    assert [d["name"] for d in browser.get(DEVICES).json()["devices"]] == ["Kept"]
    # Revoking twice, or what is not a device of the account, is not found.
    assert browser.delete(f"{DEVICES}/{device_id}").status_code == 404
    assert browser.delete(f"{DEVICES}/not-an-id").status_code == 422
    event, detail = site.events(EMAIL)[-1]
    assert event == "device.revoked"
    assert detail == {"device_id": device_id, "live_sessions": "ended"}
    kinds = site.su.execute(
        "SELECT credential_kind FROM player.audit_events WHERE event = 'device.revoked'"
    ).fetchall()
    assert kinds == [("session",)]


def test_the_app_can_revoke_its_own_token(site: Site) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    app = pairhelp.app_client(site)
    assert app.delete(DEVICE, headers=bearer(token)).status_code == 204
    _refused(app, token, "token_revoked")
    assert pairhelp.device_rows(site, EMAIL) == [("Studio PC", True, True)]
    kinds = site.su.execute(
        "SELECT e.credential_kind, e.credential_id = d.id FROM player.audit_events e, "
        "player.devices d WHERE e.event = 'device.revoked'"
    ).fetchall()
    assert kinds == [("device", True)]


def test_the_answers_to_a_token_that_does_not_work(site: Site) -> None:
    browser = _signed_in(site)
    idle = pairhelp.pair(site, browser, "Idle")
    app = pairhelp.app_client(site)
    _refused(app, new_token("dev"), "token_unknown")
    site.su.execute(
        "UPDATE player.devices SET created_at = now() - interval '1 year', "
        "last_used_at = now() - interval '181 days'"
    )
    _refused(app, idle, "token_expired")
    # A token nobody used within 24 hours of pairing: the device counts as deleted.
    site.su.execute(
        "UPDATE player.devices SET created_at = now() - interval '25 hours', last_used_at = NULL"
    )
    _refused(app, idle, "token_unknown")
    assert browser.get(DEVICES).json() == {"devices": []}
    # The account is deleted: no such token.
    lost = pairhelp.pair(site, browser, "Lost")
    assert app.get(DEVICE, headers=bearer(lost)).status_code == 200
    site.su.execute("DELETE FROM player.accounts")
    _refused(app, lost, "token_unknown")


def test_sixty_requests_a_minute_per_device_token(site: Site) -> None:
    browser = _signed_in(site)
    token, other = pairhelp.pair(site, browser), pairhelp.pair(site, browser, "Other")
    app = pairhelp.app_client(site)
    pairhelp.settle(site, 60)
    for _ in range(60):
        assert app.get(DEVICE, headers=bearer(token)).status_code == 200
    limited = app.get(DEVICE, headers=bearer(token))
    assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    assert 1 <= int(limited.headers["retry-after"]) <= 60
    # Over the limit it also cannot revoke; per token, so the other device is not held back.
    assert app.delete(DEVICE, headers=bearer(token)).status_code == 429
    assert app.get(DEVICE, headers=bearer(other)).status_code == 200


@pytest.mark.parametrize("state", ["revoked", "unknown"])
def test_the_same_dead_token_is_refused_without_a_lookup_after_twenty_tries(
    site: Site, monkeypatch: pytest.MonkeyPatch, state: str
) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    working = pairhelp.pair(site, browser, "Working")
    app = pairhelp.app_client(site)
    if state == "revoked":
        assert app.delete(DEVICE, headers=bearer(token)).status_code == 204
    else:
        token = new_token("dev")
    seen = _lookups(monkeypatch)
    pairhelp.settle(site, 300)
    for _ in range(20):
        _refused(app, token, "token_" + state)
    # The twenty-first try passes the limit: from now on this process does not look it up.
    for _ in range(3):
        blocked = app.get(DEVICE, headers=bearer(token))
        assert blocked.status_code == 429 and blocked.json() == {"error": "too_many_requests"}
        assert 1 <= int(blocked.headers["retry-after"]) <= 300
    assert len(seen) == 21
    # Only that token from that address: another token there, and that token elsewhere.
    assert app.get(DEVICE, headers=bearer(working)).status_code == 200
    _refused(pairhelp.app_client(site, "198.51.100.9"), token, "token_" + state)
    assert len(seen) == 23


def test_an_expired_token_is_not_counted_towards_the_refusal(site: Site) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    site.su.execute(
        "UPDATE player.devices SET created_at = now() - interval '1 year', "
        "last_used_at = now() - interval '181 days'"
    )
    app = pairhelp.app_client(site)
    for _ in range(22):
        _refused(app, token, "token_expired")


def test_many_unknown_tokens_from_one_address_do_not_stop_a_valid_one(site: Site) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    app = pairhelp.app_client(site)
    pairhelp.settle(site, 300, margin=8.0)
    for _ in range(200):
        _refused(app, new_token("dev"), "token_unknown")
    limited = app.get(DEVICE, headers=bearer(new_token("dev")))
    assert limited.status_code == 429 and limited.json() == {"error": "too_many_requests"}
    assert 1 <= int(limited.headers["retry-after"]) <= 300
    # Over its limit the address gets no counter row for each further token it makes up: the
    # address's counter is checked first, and the per-token one is then left alone.
    count = "SELECT count(*)::int, sum(hits)::int FROM player.rate_limits"
    rows = site.su.execute(count).fetchone()
    assert rows is not None and isinstance(rows[1], int)
    for _ in range(5):
        again = app.get(DEVICE, headers=bearer(new_token("dev")))
        assert again.status_code == 429 and again.json() == {"error": "too_many_requests"}
    after = site.su.execute(count).fetchone()
    assert after == (rows[0], rows[1] + 5)
    # A studio behind one address is not locked out: its valid token keeps working.
    assert app.get(DEVICE, headers=bearer(token)).status_code == 200
    # Another address is not held back.
    _refused(pairhelp.app_client(site, "198.51.100.9"), new_token("dev"), "token_unknown")
