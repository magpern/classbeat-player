"""The re-check and its listener, on the test database (ADR 0002, section 8; ADR 0005, s. 2).

Deleting the account and revoking the device end the account's live sessions: at once on the
`live_revocations` notice, and by the 30-second re-check when the notice is missed. A site
session that ends drops the controller it signed in, and the session goes on. A lost listening
connection is opened again and every session is re-checked at once. The notice itself carries
no authority. A re-check the database cannot answer ends nothing by itself.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from typing import cast

import pytest

from player_backend.db.executor import open_pool
from player_backend.live.recheck import RecheckLoop, RecheckTiming
from player_backend.live.registry import Dropped, Ended, Registry
from player_backend.live.service import LiveService
from player_backend.live.watchers import Event
from player_backend.token_policy import token_hash
from tests import pairhelp
from tests.pairhelp import DEVICES, bearer
from tests.sitehelp import SESSION_COOKIE, Browser, Site, running_site

EMAIL = "rider@example.test"
OTHER = "other@example.test"
LIVE = "/api/live/sessions"
DELETE_ACCOUNT = "/api/site/account/delete"
# The loop's full re-check never comes within a test that uses this: only a notice acts.
NOTICE_ONLY = RecheckTiming(every=3600.0, tick=0.05)
# A full re-check every 0.3 s: stands for the 30 seconds.
PERIODIC = RecheckTiming(every=0.3, tick=0.05)


def _service(site: Site) -> LiveService:
    return cast(LiveService, site.app.state.live)


def _until(check: Callable[[], bool], seconds: float = 5.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.02)
    return check()


def _account(site: Site, email: str = EMAIL) -> tuple[Browser, Browser, str]:
    site.allow(email)
    browser = site.sign_in(email)
    app = pairhelp.app_client(site)
    return browser, app, pairhelp.pair(site, browser, "Studio PC", app)


def _start(app: Browser, token: str) -> str:
    answer = app.post(LIVE, headers=bearer(token))
    assert answer.status_code == 200, answer.text
    return str(answer.json()["sessionId"])


def _running(site: Site) -> set[str]:
    return {str(r.session_id) for r in _service(site).registry.running()}


def _watched(site: Site) -> list[Event]:
    seen: list[Event] = []
    _service(site).registry.watch(seen.append)
    return seen


def _site(app_url: str, db_url: str, timing: RecheckTiming | None) -> AbstractContextManager[Site]:
    return running_site(app_url, db_url, live_recheck=timing)


@pytest.fixture
def noticed(app_url: str, db_url: str) -> Iterator[Site]:
    with _site(app_url, db_url, NOTICE_ONLY) as site:
        yield site


@pytest.fixture
def periodic(app_url: str, db_url: str) -> Iterator[Site]:
    with _site(app_url, db_url, PERIODIC) as site:
        yield site


def _ended(seen: list[Event], session_id: str) -> list[str]:
    return [e.reason for e in seen if isinstance(e, Ended) and str(e.session_id) == session_id]


# By the re-check called directly -------------------------------------------------------------


def test_a_revoked_device_ends_its_session_and_writes_no_end(site: Site) -> None:
    browser, app, token = _account(site)
    session_id = _start(app, token)
    seen = _watched(site)
    assert _service(site).recheck() is True
    assert _running(site) == {session_id}
    device_id = browser.get(DEVICES).json()["devices"][0]["id"]
    assert browser.delete(f"{DEVICES}/{device_id}").status_code == 204
    assert _service(site).recheck() is True
    assert _running(site) == set() and _ended(seen, session_id) == ["revoked"]
    events = [event for event, _ in site.events(EMAIL)]
    assert "live.session_ended" not in events and "device.revoked" in events


def test_one_accounts_recheck_leaves_the_others_sessions(site: Site) -> None:
    _, app, token = _account(site)
    _, other_app, other_token = _account(site, OTHER)
    mine, theirs = _start(app, token), _start(other_app, other_token)
    site.su.execute("UPDATE player.devices SET revoked_at = now()")  # both, without a notice
    other_id = _service(site).registry.running()
    account = next(r.account_id for r in other_id if str(r.session_id) == theirs)
    assert _service(site).recheck(account) is True
    assert _running(site) == {mine}


def test_a_signed_in_controller_is_dropped_when_its_site_session_ends(site: Site) -> None:
    browser, app, token = _account(site)
    session_id = uuid.UUID(_start(app, token))
    cookie = browser.cookies.get(SESSION_COOKIE)
    assert cookie is not None
    registry = _service(site).registry
    signed_in = registry.add_controller(session_id, bytes(32), token_hash(cookie))
    by_code = registry.add_controller(session_id, b"c" * 32, None)
    assert (signed_in, by_code) == (1, 2)
    seen = _watched(site)
    assert _service(site).recheck() is True and seen == []
    assert browser.post("/api/site/sign-out").status_code == 204
    assert _service(site).recheck() is True
    # That controller is dropped; the session and the controller by a code go on.
    assert seen == [Dropped(session_id, 1, "session_ended", "sign_in", bytes(32))]
    assert _running(site) == {str(session_id)}
    assert registry.signed_in_controllers() == []


def test_a_database_that_does_not_answer_ends_nothing(app_url: str, site: Site) -> None:
    _, app, token = _account(site)
    session_id = _start(app, token)
    pool = open_pool(app_url)
    pool.close()
    registry = _service(site).registry
    blind = LiveService(registry, pool)
    assert blind.recheck() is False
    assert _running(site) == {session_id}


def test_an_unconfirmed_session_ends_by_the_sweep_and_is_recorded(site: Site) -> None:
    _, _, token = _account(site)
    now = [0.0]
    registry = Registry()
    service = LiveService(registry, _service(site).pool, lambda: now[0])
    # A session of the app's own device, held by a service with a clock of the test's.
    started = registry.start(uuid.uuid4(), uuid.uuid4(), token_hash(token), 0.0)
    assert started is not None
    registry.host_connected(started.session_id)
    now[0] = 89.0
    service.sweep()
    assert len(registry.running()) == 1
    now[0] = 90.0
    service.sweep()
    assert registry.running() == []
    ended = {"session_id": str(started.session_id), "reason": "unconfirmed"}
    assert ("live.session_ended", ended) in site.events(EMAIL)


# By the loop: the notice -------------------------------------------------------------------


def test_deleting_the_account_ends_its_session_at_once(noticed: Site) -> None:
    browser, app, token = _account(noticed)
    session_id = _start(app, token)
    seen = _watched(noticed)
    answer = browser.post(DELETE_ACCOUNT, json={"confirm": EMAIL})
    assert answer.status_code == 204
    assert _until(lambda: _running(noticed) == set())
    assert _ended(seen, session_id) == ["revoked"]


def test_revoking_the_device_ends_its_session_at_once(noticed: Site) -> None:
    browser, app, token = _account(noticed)
    _, other_app, other_token = _account(noticed, OTHER)
    session_id, other = _start(app, token), _start(other_app, other_token)
    seen = _watched(noticed)
    device_id = browser.get(DEVICES).json()["devices"][0]["id"]
    assert browser.delete(f"{DEVICES}/{device_id}").status_code == 204
    assert _until(lambda: _running(noticed) == {other})
    assert _ended(seen, session_id) == ["revoked"]


def test_the_app_revoking_its_own_device_ends_its_session(noticed: Site) -> None:
    _, app, token = _account(noticed)
    _start(app, token)
    assert app.delete(pairhelp.DEVICE, headers=bearer(token)).status_code == 204
    assert _until(lambda: _running(noticed) == set())


def test_a_notice_carries_no_authority(noticed: Site) -> None:
    _, app, token = _account(noticed)
    session_id = _start(app, token)
    account = _service(noticed).registry.running()[0].account_id
    # A notice for the account with nothing revoked: the re-check answers active.
    noticed.su.execute("SELECT pg_notify('live_revocations', %s)", (str(account),))
    noticed.su.execute("SELECT pg_notify('live_revocations', 'not an account')")
    time.sleep(0.5)
    assert _running(noticed) == {session_id}


def test_without_the_notice_nothing_ends_before_the_full_recheck(noticed: Site) -> None:
    _, app, token = _account(noticed)
    session_id = _start(app, token)
    noticed.su.execute("DELETE FROM player.devices")  # no notice
    time.sleep(0.5)
    assert _running(noticed) == {session_id}


# By the loop: the full re-check, a missed notice ---------------------------------------------


def test_a_missed_notice_on_deletion_is_caught_by_the_full_recheck(periodic: Site) -> None:
    _, app, token = _account(periodic)
    session_id = _start(app, token)
    seen = _watched(periodic)
    periodic.su.execute("DELETE FROM player.accounts WHERE email = %s", (EMAIL,))  # no notice
    assert _until(lambda: _running(periodic) == set())
    assert _ended(seen, session_id) == ["revoked"]


def test_a_missed_notice_on_revocation_is_caught_by_the_full_recheck(periodic: Site) -> None:
    _, app, token = _account(periodic)
    session_id = _start(app, token)
    periodic.su.execute("UPDATE player.devices SET revoked_at = now()")  # no notice
    assert _until(lambda: _running(periodic) == set())
    assert session_id not in _running(periodic)


# By the loop: the listening connection ------------------------------------------------------


def _listeners(site: Site) -> int:
    row = site.su.execute(
        "SELECT count(*) FROM pg_stat_activity "
        "WHERE usename = 'player_app' AND query = 'LISTEN live_revocations'"
    ).fetchone()
    assert row is not None
    return cast(int, row[0])


def test_a_lost_listener_comes_back_and_rechecks_every_session(noticed: Site) -> None:
    _, app, token = _account(noticed)
    _start(app, token)
    assert _until(lambda: _listeners(noticed) == 1)
    noticed.su.execute("UPDATE player.devices SET revoked_at = now()")  # no notice
    noticed.su.execute(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
        "WHERE usename = 'player_app' AND query = 'LISTEN live_revocations'"
    )
    # Opened again after a second, and the full re-check runs at once when it is back.
    assert _until(lambda: _running(noticed) == set(), 5.0)
    assert _until(lambda: _listeners(noticed) == 1)


def test_the_app_as_built_by_default_runs_the_loop(app_url: str, db_url: str) -> None:
    # `create_app` with no `live_recheck`, as production builds it: its own listener is open,
    # and a revocation ends the session through it.
    with running_site(app_url, db_url, live_default=True) as site:
        assert _until(lambda: _listeners(site) == 1)
        browser, app, token = _account(site)
        session_id = _start(app, token)
        seen = _watched(site)
        device_id = browser.get(DEVICES).json()["devices"][0]["id"]
        assert browser.delete(f"{DEVICES}/{device_id}").status_code == 204
        assert _until(lambda: _running(site) == set())
        assert _ended(seen, session_id) == ["revoked"]
    with running_site(app_url, db_url) as site:
        assert _until(lambda: _listeners(site) == 0)


def test_the_loop_stops_with_the_app_and_closes_its_listener(app_url: str, db_url: str) -> None:
    with _site(app_url, db_url, NOTICE_ONLY) as site:
        assert _until(lambda: _listeners(site) == 1)
        stopping = time.monotonic()
    assert time.monotonic() - stopping < 2.0
    with _site(app_url, db_url, None) as site:
        assert _until(lambda: _listeners(site) == 0)


def test_the_loop_keeps_going_after_an_unexpected_error(site: Site, app_url: str) -> None:
    calls: list[uuid.UUID | None] = []

    class Failing(LiveService):
        def recheck(self, account_id: uuid.UUID | None = None) -> bool:
            calls.append(account_id)
            if len(calls) == 1:
                raise RuntimeError("once")
            return True

    service = Failing(Registry(), _service(site).pool)
    loop = RecheckLoop(service, app_url, RecheckTiming(every=0.05, tick=0.02))
    loop.start()
    try:
        assert _until(lambda: len(calls) >= 3)
    finally:
        loop.stop()
