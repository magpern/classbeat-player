"""Guard: with two accounts, every endpoint is called as one and can neither read nor change
the other's rows (ADR 0002, section 9, the last guard of its list).

Every route that enters an account, by a site session or by a device token, must have a case
below: a new one fails until it has.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import LiteralString

from player_backend.player_api.deps import device_token
from player_backend.site.deps import site_session
from tests import pairhelp
from tests.pairhelp import DECIDE, DEVICE, DEVICES, FIND, bearer
from tests.routehelp import routes_of
from tests.sitehelp import Browser, Site

A = "a@example.test"
B = "b@example.test"
SESSIONS = "/api/site/sessions"


@dataclass(frozen=True)
class Other:
    """What account B owns, as far as account A could ever name it."""

    session_id: str
    device_id: str
    token: str  # B's device token: B's to hold, used here only to see that it still works
    user_code: str  # of a pairing B has approved and whose token is not collected yet


@dataclass(frozen=True)
class Actor:
    """Account A: a signed-in browser, and its app with a device token."""

    browser: Browser
    app: Browser
    token: str
    other: Other


def _snapshot(site: Site, email: str) -> list[tuple[object, ...]]:
    """Everything the account owns that these endpoints could touch."""
    found: list[tuple[object, ...]] = []
    for statement in (
        "SELECT 'session', s.id::text, s.token_hash::text FROM player.sessions s "
        "JOIN player.accounts a ON a.id = s.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'event', e.id::text, e.event FROM player.audit_events e "
        "JOIN player.accounts a ON a.id = e.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'device', d::text, '' FROM player.devices d "
        "JOIN player.accounts a ON a.id = d.account_id WHERE a.email = %s ORDER BY 2",
        "SELECT 'pairing', p.id::text, p.state || ':' || p.device_name FROM player.pairings p "
        "JOIN player.accounts a ON a.id = p.account_id WHERE a.email = %s ORDER BY 2",
    ):
        found.extend(site.su.execute(statement, (email,)).fetchall())
    return found


def _one(site: Site, statement: LiteralString, email: str) -> str:
    row = site.su.execute(statement, (email,)).fetchone()
    assert row is not None
    return str(row[0])


def _list(site: Site, a: Actor) -> None:
    listed = a.browser.get(SESSIONS).json()["sessions"]
    assert len(listed) == 1 and listed[0]["current"] is True
    assert a.other.session_id not in str(listed)


def _end_one(site: Site, a: Actor) -> None:
    # B's session id is known to A here; it is still not A's to end.
    assert a.browser.delete(f"{SESSIONS}/{a.other.session_id}").status_code == 404


def _sign_out(site: Site, a: Actor) -> None:
    assert a.browser.post("/api/site/sign-out").status_code == 204


def _end_all(site: Site, a: Actor) -> None:
    assert a.browser.post(f"{SESSIONS}/end-all").status_code == 204


def _find_pairing(site: Site, a: Actor) -> None:
    # The code of a pairing B approved is known to A here; it shows A nothing.
    found = a.browser.post(FIND, json={"code": a.other.user_code})
    assert found.status_code == 404


def _decide_pairing(site: Site, a: Actor) -> None:
    for approve in (False, True):
        body = {"code": a.other.user_code, "approve": approve, "name": "Taken"}
        assert a.browser.post(DECIDE, json=body).status_code == 404


def _list_devices(site: Site, a: Actor) -> None:
    listed = a.browser.get(DEVICES).json()["devices"]
    assert [device["name"] for device in listed] == ["A PC"]
    assert a.other.device_id not in str(listed)


def _revoke_device(site: Site, a: Actor) -> None:
    # B's device id is known to A here; it is still not A's to revoke.
    assert a.browser.delete(f"{DEVICES}/{a.other.device_id}").status_code == 404


def _own_device(site: Site, a: Actor) -> None:
    answer = a.app.get(DEVICE, headers=bearer(a.token))
    assert answer.status_code == 200 and answer.json()["device"]["name"] == "A PC"
    assert "B PC" not in answer.text


def _revoke_own_device(site: Site, a: Actor) -> None:
    assert a.app.delete(DEVICE, headers=bearer(a.token)).status_code == 204
    assert a.app.get(DEVICE, headers=bearer(a.token)).status_code == 401


# In this order: the last two end A's device and A's sessions.
CASES: dict[tuple[str, str], Callable[[Site, Actor], None]] = {
    ("GET", "/api/site/sessions"): _list,
    ("DELETE", "/api/site/sessions/{session_id}"): _end_one,
    ("POST", "/api/site/sign-out"): _sign_out,
    ("POST", "/api/site/pairing/find"): _find_pairing,
    ("POST", "/api/site/pairing/decide"): _decide_pairing,
    ("GET", "/api/site/devices"): _list_devices,
    ("DELETE", "/api/site/devices/{device_id}"): _revoke_device,
    ("GET", "/api/player/device"): _own_device,
    ("DELETE", "/api/player/device"): _revoke_own_device,
    ("POST", "/api/site/sessions/end-all"): _end_all,
}


def test_every_endpoint_that_enters_an_account_has_a_case(site: Site) -> None:
    entering = {
        (r.method, r.path)
        for r in routes_of(site.app)
        if site_session in r.dependencies or device_token in r.dependencies
    }
    assert entering == set(CASES)


def _account_b(site: Site) -> tuple[Browser, Other]:
    b = site.sign_in(B, site.browser("198.51.100.2"))
    app = pairhelp.app_client(site, "198.51.100.2")
    token = pairhelp.pair(site, b, "B PC", app)
    # Used once, so that "last used" is already written when the rows are compared.
    assert app.get(DEVICE, headers=bearer(token)).status_code == 200
    waiting = pairhelp.start(site, app)
    assert pairhelp.approve(b, waiting, "B waiting").status_code == 200
    other = Other(
        session_id=_one(
            site,
            "SELECT x.id::text FROM player.sessions x "
            "JOIN player.accounts a ON a.id = x.account_id WHERE a.email = %s",
            B,
        ),
        device_id=_one(
            site,
            "SELECT x.id::text FROM player.devices x "
            "JOIN player.accounts a ON a.id = x.account_id WHERE a.email = %s",
            B,
        ),
        token=token,
        user_code=waiting.user_code,
    )
    return b, other


def test_as_one_account_no_endpoint_reads_or_changes_the_others_rows(site: Site) -> None:
    site.allow(A)
    site.allow(B)
    b, other = _account_b(site)
    b_app = pairhelp.app_client(site, "198.51.100.2")
    a_app = pairhelp.app_client(site, "198.51.100.1")
    first = site.sign_in(A, site.browser("198.51.100.1"))
    a_token = pairhelp.pair(site, first, "A PC", a_app)
    assert first.post("/api/site/sign-out").status_code == 204
    for case in CASES.values():
        site.su.execute("DELETE FROM player.rate_limits")
        a = Actor(site.sign_in(A, site.browser("198.51.100.1")), a_app, a_token, other)
        before = _snapshot(site, B)
        # A session, a device, a pairing that waits, and the events of making them.
        assert [row[0] for row in before] == ["session", *["event"] * 4, "device", "pairing"]
        case(site, a)
        assert _snapshot(site, B) == before
        assert b.get(SESSIONS).status_code == 200
        assert b_app.get(DEVICE, headers=bearer(other.token)).status_code == 200
    # And the cases did act on A's own rows: the last two revoked A's device and ended every
    # session of A.
    assert pairhelp.device_rows(site, A) == [("A PC", True, True)]
    assert site.su.execute(
        "SELECT count(*) FROM player.sessions s JOIN player.accounts a ON a.id = s.account_id "
        "WHERE a.email = %s",
        (A,),
    ).fetchone() == (0,)
