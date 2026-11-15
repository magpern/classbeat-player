"""What an accepted classbeat event does to the account (ADR 0010, section 8; #496).

`account-deleted` removes the account and everything it owns, as the deletion on the site does
(ADR 0002, section 12). `sessions-revoked` ends every site session, records
`session.all_ended` (`by: classbeat`) and drops a live controller held through one; devices go
on. Both send the `live_revocations` notice.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator

import psycopg
import pytest
from psycopg import sql

from player_backend.live.recheck import RecheckTiming
from player_backend.live.service import LiveService
from player_backend.token_policy import token_hash
from tests import sourcehelp as sh
from tests.accounthelp import LIBRARY, Held, full_account, owned_tables
from tests.classbeathelp import (
    ACCOUNT_DELETED,
    EVENTS,
    FORM,
    ISSUER,
    SESSIONS_REVOKED,
    FakeClassbeat,
    client,
    event_body,
    event_token,
)
from tests.dbhelp import Conn
from tests.pairhelp import DEVICE, bearer
from tests.sitehelp import SESSION_COOKIE, Site, running_site

A = "a@example.test"
B = "b@example.test"
SUBJECT_A = "pairwise-subject-a"
SUBJECT_B = "pairwise-subject-b"
KNOWN = {
    "accounts",
    "sessions",
    "passkeys",
    "passkey_registrations",
    "devices",
    "source_links",
    "classes",
    "account_sync",
    "audit_events",
    "pairings",
    "source_link_codes",
}
NOTICE_ONLY = RecheckTiming(every=3600.0, tick=0.05)


@pytest.fixture
def fake() -> FakeClassbeat:
    return FakeClassbeat()


@pytest.fixture
def site(app_url: str, db_url: str, fake: FakeClassbeat) -> Iterator[Site]:
    with running_site(app_url, db_url, live_recheck=NOTICE_ONLY, classbeat=client(fake)) as s:
        yield s


@pytest.fixture
def listener(db_url: str) -> Iterator[Conn]:
    with psycopg.connect(db_url, autocommit=True) as conn:
        conn.execute("LISTEN live_revocations")
        yield conn


def _linked(site: Site, held: Held, subject: str) -> Held:
    site.su.execute(
        "UPDATE player.accounts SET kind = 'instructor', classbeat_issuer = %s, "
        "classbeat_subject = %s WHERE id = %s",
        (ISSUER, subject, held.account_id),
    )
    return held


def _two(site: Site) -> tuple[Held, Held]:
    a = full_account(site, A, "198.51.100.1", "192.0.2.21")
    b = full_account(site, B, "198.51.100.2", "192.0.2.22")
    return _linked(site, a, SUBJECT_A), _linked(site, b, SUBJECT_B)


def _send(site: Site, fake: FakeClassbeat, event: str, subject: str) -> None:
    server = site.browser("192.0.2.90", headers={"User-Agent": "classbeat-events/1"})
    token = event_token(fake.key, event, int(time.time()), subject)
    answer = server.post(EVENTS, content=event_body(token).encode(), headers=FORM)
    assert (answer.status_code, answer.content) == (200, b""), answer.text


def _rows(site: Site, held: Held) -> dict[str, list[tuple[object, ...]]]:
    found: dict[str, list[tuple[object, ...]]] = {}
    for table, column in owned_tables(site):
        statement = sql.SQL("SELECT t::text FROM player.{} t WHERE {} = %s ORDER BY 1").format(
            sql.Identifier(table), sql.Identifier(column)
        )
        found[table] = site.su.execute(statement, (held.account_id,)).fetchall()
    return found


def _heard(listener: Conn) -> list[tuple[str, str]]:
    return [(n.channel, n.payload) for n in listener.notifies(timeout=1.0)]


def _until(check: object, seconds: float = 5.0) -> bool:
    assert callable(check)
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.02)
    return bool(check())


def _service(site: Site) -> LiveService:
    service = site.app.state.live
    assert isinstance(service, LiveService)
    return service


def test_account_deleted_removes_every_row_it_owns_and_nothing_else(
    site: Site, fake: FakeClassbeat, listener: Conn
) -> None:
    a, b = _two(site)
    assert {table for table, _ in owned_tables(site)} >= KNOWN
    before_a, before_b = _rows(site, a), _rows(site, b)
    assert all(before_a[table] for table in KNOWN), {t for t in KNOWN if not before_a[t]}
    _send(site, fake, ACCOUNT_DELETED, SUBJECT_A)
    assert all(not rows for rows in _rows(site, a).values()), _rows(site, a)
    assert site.su.execute(
        "SELECT count(*) FROM player.audit_events WHERE account_id = %s", (a.account_id,)
    ).fetchone() == (0,)
    assert _rows(site, b) == before_b
    assert _heard(listener) == [("live_revocations", str(a.account_id))]
    listed = b.browser.get(LIBRARY)
    assert listed.status_code == 200 and "Class of " + B in listed.text


def test_after_account_deleted_every_token_of_the_account_is_refused(
    site: Site, fake: FakeClassbeat
) -> None:
    a, b = _two(site)
    _send(site, fake, ACCOUNT_DELETED, SUBJECT_A)
    for token in a.session_tokens:
        stolen = site.browser("198.51.100.1")
        stolen.cookies.set(SESSION_COOKIE, token, domain="player.test")
        assert stolen.get("/api/site/sessions").status_code == 401
    refused = a.app.get(DEVICE, headers=bearer(a.device_token))
    assert refused.status_code == 401 and refused.json() == {"error": "token_unknown"}
    published = sh.publish(a.server, a.source_token, sh.envelope("kept", 3, sh.document()))
    assert published.status_code == 401
    assert b.browser.get("/api/site/sessions").status_code == 200
    assert b.app.get(DEVICE, headers=bearer(b.device_token)).status_code == 200


def test_sessions_revoked_ends_every_session_and_keeps_the_devices(
    site: Site, fake: FakeClassbeat, listener: Conn
) -> None:
    a, b = _two(site)
    before_b = _rows(site, b)
    devices_before = site.su.execute(
        "SELECT id, revoked_at FROM player.devices WHERE account_id = %s ORDER BY id",
        (a.account_id,),
    ).fetchall()
    _send(site, fake, SESSIONS_REVOKED, SUBJECT_A)
    assert site.su.execute(
        "SELECT count(*) FROM player.sessions WHERE account_id = %s", (a.account_id,)
    ).fetchone() == (0,)
    assert a.browser.get("/api/site/sessions").status_code == 401
    assert a.other.get("/api/site/sessions").status_code == 401
    # The event: who ended them and how many, nothing of the token.
    ended = site.su.execute(
        "SELECT detail FROM player.audit_events WHERE account_id = %s "
        "AND event = 'session.all_ended'",
        (a.account_id,),
    ).fetchall()
    assert ended == [({"by": "classbeat", "sessions": 2},)]
    assert _heard(listener) == [("live_revocations", str(a.account_id))]
    # Devices, the source link and the classes go on.
    assert (
        site.su.execute(
            "SELECT id, revoked_at FROM player.devices WHERE account_id = %s ORDER BY id",
            (a.account_id,),
        ).fetchall()
        == devices_before
    )
    assert a.app.get(DEVICE, headers=bearer(a.device_token)).status_code == 200
    read = a.server.get(f"{sh.CLASSES}/kept", headers=sh.bearer(a.source_token))
    assert read.status_code == 200
    # The account and B are untouched; signing in again works.
    assert site.su.execute(
        "SELECT count(*) FROM player.accounts WHERE id = %s", (a.account_id,)
    ).fetchone() == (1,)
    assert _rows(site, b) == before_b
    assert site.sign_in(A).get("/api/site/sessions").status_code == 200


def test_sessions_revoked_with_no_session_records_none_ended(
    site: Site, fake: FakeClassbeat
) -> None:
    a, _ = _two(site)
    site.su.execute("DELETE FROM player.sessions WHERE account_id = %s", (a.account_id,))
    _send(site, fake, SESSIONS_REVOKED, SUBJECT_A)
    ended = site.su.execute(
        "SELECT detail FROM player.audit_events WHERE account_id = %s "
        "AND event = 'session.all_ended'",
        (a.account_id,),
    ).fetchall()
    assert ended == [({"by": "classbeat", "sessions": 0},)]


def test_sessions_revoked_drops_a_controller_signed_in_through_a_session(
    site: Site, fake: FakeClassbeat
) -> None:
    a, _ = _two(site)
    started = a.app.post("/api/live/sessions", headers=bearer(a.device_token))
    assert started.status_code == 200, started.text
    session_id = uuid.UUID(str(started.json()["sessionId"]))
    registry = _service(site).registry
    registry.add_controller(session_id, bytes(32), token_hash(a.session_tokens[0]))
    registry.add_controller(session_id, b"c" * 32, None)
    assert len(registry.signed_in_controllers()) == 1
    _send(site, fake, SESSIONS_REVOKED, SUBJECT_A)
    # On the notice: the signed-in controller goes, the live session (its device) goes on.
    assert _until(lambda: registry.signed_in_controllers() == [])
    assert {str(r.session_id) for r in registry.running()} == {str(session_id)}
