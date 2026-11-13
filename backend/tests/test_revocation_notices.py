"""The `live_revocations` notice of the revoking transactions (ADR 0002, section 8; ADR 0005,
section 2), heard by a listener of its own as the live process will be.

Revoking a device (on the site and by the app itself), ending one session, signing out
everywhere and deleting the account each send one notice with the account id, only once the
transaction has committed; a refused or rolled-back one sends none. After the notice the re-check
(`auth_device_active`, `auth_session_active`) answers not active.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import psycopg
import pytest

from player_backend.client_policy import ClientInfo
from player_backend.db import account, devices, revocation, site_sessions
from player_backend.token_policy import token_hash
from tests import pairhelp
from tests.dbhelp import Conn
from tests.sitehelp import SESSION_COOKIE, Browser, Site

EMAIL = "rider@example.test"
DEVICES = "/api/site/devices"
SESSIONS = "/api/site/sessions"
CLIENT = ClientInfo(network="203.0.113.0/24", family="Firefox")
# Long enough for a committed notice to arrive on a loopback connection; a test that expects
# none waits this long for nothing.
WAIT = 1.0


class Rolled(Exception):
    """Raised in a request's transaction to roll it back."""


@pytest.fixture
def listener(db_url: str) -> Iterator[Conn]:
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("LISTEN live_revocations")
        yield conn


def _heard(listener: Conn, wait: float = WAIT) -> list[tuple[str, str]]:
    """(channel, payload) of every notice heard within `wait` seconds."""
    return [(n.channel, n.payload) for n in listener.notifies(timeout=wait)]


def _signed_in(site: Site, email: str = EMAIL) -> Browser:
    site.allow(email)
    return site.sign_in(email)


def _account_id(site: Site, email: str = EMAIL) -> str:
    row = site.su.execute("SELECT id FROM player.accounts WHERE email = %s", (email,)).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return str(row[0])


def _session_hash(browser: Browser) -> bytes:
    cookie = browser.cookies.get(SESSION_COOKIE)
    assert cookie is not None
    return token_hash(cookie)


def _active(site: Site, function: str, digest: bytes) -> bool:
    if function == "device":
        row = site.su.execute("SELECT player.auth_device_active(%s)", (digest,)).fetchone()
    else:
        row = site.su.execute("SELECT player.auth_session_active(%s)", (digest,)).fetchone()
    assert row is not None and isinstance(row[0], bool)
    return row[0]


def _device_id(browser: Browser, name: str) -> str:
    listed = browser.get(DEVICES).json()["devices"]
    return next(str(d["id"]) for d in listed if d["name"] == name)


def test_the_channel_is_the_one_the_adrs_name() -> None:
    assert revocation.CHANNEL == "live_revocations"


def test_revoking_a_device_on_the_site_sends_one_notice_and_ends_its_check(
    site: Site, listener: Conn
) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    kept = pairhelp.pair(site, browser, "Kept")
    assert _active(site, "device", token_hash(token)) is True
    assert _heard(listener, 0.2) == []
    assert browser.delete(f"{DEVICES}/{_device_id(browser, 'Studio PC')}").status_code == 204
    assert _heard(listener) == [(revocation.CHANNEL, _account_id(site))]
    assert _active(site, "device", token_hash(token)) is False
    assert _active(site, "device", token_hash(kept)) is True


def test_the_app_revoking_its_own_token_sends_one_notice(site: Site, listener: Conn) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    app = pairhelp.app_client(site)
    assert app.delete("/api/player/device", headers=pairhelp.bearer(token)).status_code == 204
    assert _heard(listener) == [(revocation.CHANNEL, _account_id(site))]
    assert _active(site, "device", token_hash(token)) is False


def test_a_refused_revocation_sends_none(site: Site, listener: Conn) -> None:
    browser = _signed_in(site)
    pairhelp.pair(site, browser)
    answer = browser.delete(f"{DEVICES}/{uuid.uuid4()}")
    assert answer.status_code == 404
    assert _heard(listener) == []


def test_ending_one_session_sends_one_notice(site: Site, listener: Conn) -> None:
    browser = _signed_in(site)
    other = site.sign_in(EMAIL)
    digest = _session_hash(other)
    listed = browser.get(SESSIONS).json()["sessions"]
    target = next(s["id"] for s in listed if not s["current"])
    assert browser.delete(f"{SESSIONS}/{target}").status_code == 204
    assert _heard(listener) == [(revocation.CHANNEL, _account_id(site))]
    assert _active(site, "session", digest) is False
    assert _active(site, "session", _session_hash(browser)) is True


def test_signing_out_everywhere_sends_one_notice(site: Site, listener: Conn) -> None:
    browser = _signed_in(site)
    other = site.sign_in(EMAIL)
    digests = (_session_hash(browser), _session_hash(other))
    assert browser.post(f"{SESSIONS}/end-all").status_code == 204
    # One notice for the transaction, however many sessions it ended.
    assert _heard(listener) == [(revocation.CHANNEL, _account_id(site))]
    assert [_active(site, "session", d) for d in digests] == [False, False]


def test_deleting_the_account_sends_one_notice_and_ends_every_check(
    site: Site, listener: Conn
) -> None:
    browser = _signed_in(site)
    token = pairhelp.pair(site, browser)
    session = _session_hash(browser)
    account_id = _account_id(site)
    answer = browser.post("/api/site/account/delete", json={"confirm": EMAIL})
    assert answer.status_code == 204
    assert _heard(listener) == [(revocation.CHANNEL, account_id)]
    assert _active(site, "device", token_hash(token)) is False
    assert _active(site, "session", session) is False


def test_the_notice_is_sent_only_when_the_transaction_commits(site: Site, listener: Conn) -> None:
    browser = _signed_in(site)
    pairhelp.pair(site, browser)
    device_id = uuid.UUID(_device_id(browser, "Studio PC"))
    with site_sessions.entered(site.app.state.site.pool, _session_hash(browser)) as ctx:
        assert ctx is not None
        assert devices.revoke(ctx, device_id, CLIENT) is True
        # Written, not committed: nothing is heard yet.
        assert _heard(listener) == []
    assert _heard(listener) == [(revocation.CHANNEL, _account_id(site))]


@pytest.mark.parametrize("action", ["revoke", "end_session", "end_all", "delete"])
def test_a_rolled_back_transaction_sends_none(site: Site, listener: Conn, action: str) -> None:
    browser = _signed_in(site)
    other = site.sign_in(EMAIL)
    pairhelp.pair(site, browser)
    device_id = uuid.UUID(_device_id(browser, "Studio PC"))
    other_id = next(
        uuid.UUID(s["id"]) for s in browser.get(SESSIONS).json()["sessions"] if not s["current"]
    )
    with (
        pytest.raises(Rolled),
        site_sessions.entered(site.app.state.site.pool, _session_hash(browser)) as ctx,
    ):
        assert ctx is not None
        if action == "revoke":
            assert devices.revoke(ctx, device_id, CLIENT) is True
        elif action == "end_session":
            assert site_sessions.end_session(ctx, other_id, CLIENT) is True
        elif action == "end_all":
            assert site_sessions.end_all_sessions(ctx, CLIENT) == 2
        else:
            assert account.delete(ctx, EMAIL) == "deleted"
        raise Rolled
    assert _heard(listener) == []
    # Nothing was revoked either.
    assert _active(site, "session", _session_hash(other)) is True
    assert browser.get(SESSIONS).status_code == 200
