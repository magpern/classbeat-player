"""Pairing in the tests: the app's two calls and the user's two, through the real routes.

The app is a client without cookies and without an `Origin` header. Its codes and tokens are
whatever the backend made at run time. Time is moved by changing rows, not by waiting.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from tests.sitehelp import ADDRESS, Browser, Site

START = "/api/pairing/start"
TOKEN = "/api/pairing/token"
FIND = "/api/site/pairing/find"
DECIDE = "/api/site/pairing/decide"
DEVICES = "/api/site/devices"
DEVICE = "/api/player/device"
APP_HEADERS = {"User-Agent": "class-player/1.0"}


@dataclass(frozen=True)
class Pairing:
    app: Browser
    device_code: str
    user_code: str  # as shown: XXXX-XXXX


def app_client(site: Site, address: str = ADDRESS, *, raise_errors: bool = True) -> Browser:
    """The desktop app: no cookies, no `Origin`."""
    return site.browser(address, headers=APP_HEADERS, raise_errors=raise_errors)


def start(site: Site, app: Browser | None = None, platform: str = "linux") -> Pairing:
    app = app or app_client(site)
    response = app.post(START, json={"platform": platform, "version": "1.0"})
    assert response.status_code == 200, response.text
    body = response.json()
    return Pairing(app, body["device_code"], body["user_code"])


def poll(pairing: Pairing) -> httpx.Response:
    return pairing.app.post(TOKEN, json={"device_code": pairing.device_code})


def wait_for_next_poll(site: Site) -> None:
    """Make every pairing's last poll older than the interval."""
    site.su.execute("UPDATE player.pairings SET last_polled_at = now() - interval '6 seconds'")


def approve(browser: Browser, pairing: Pairing, name: str = "Studio PC") -> httpx.Response:
    return browser.post(DECIDE, json={"code": pairing.user_code, "approve": True, "name": name})


def deny(browser: Browser, pairing: Pairing) -> httpx.Response:
    return browser.post(DECIDE, json={"code": pairing.user_code, "approve": False})


def pair(site: Site, browser: Browser, name: str = "Studio PC", app: Browser | None = None) -> str:
    """A device paired to the account `browser` is signed in to. Returns its device token."""
    pairing = start(site, app)
    assert approve(browser, pairing, name).status_code == 200
    response = poll(pairing)
    assert response.status_code == 200, response.text
    return str(response.json()["device_token"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": "Bearer " + token}


def device_rows(site: Site, email: str) -> list[tuple[object, ...]]:
    """(name, last_used_at is set, revoked_at is set) of the account's devices, by name."""
    return site.su.execute(
        "SELECT d.name, d.last_used_at IS NOT NULL, d.revoked_at IS NOT NULL "
        "FROM player.devices d JOIN player.accounts a ON a.id = d.account_id "
        "WHERE a.email = %s ORDER BY d.name",
        (email,),
    ).fetchall()


def settle(site: Site, window_seconds: int, margin: float = 4.0) -> None:
    """Keep a test's requests inside one fixed window of the counters.

    The counters' windows start on the database's clock. In the rare run that starts within
    `margin` seconds of a window's end, wait for the next window instead of counting across two.
    """
    row = site.su.execute("SELECT extract(epoch FROM clock_timestamp())::float8").fetchone()
    assert row is not None and isinstance(row[0], float)
    left = window_seconds - row[0] % window_seconds
    if left < margin:
        time.sleep(left + 0.05)
