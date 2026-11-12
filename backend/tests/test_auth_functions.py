"""The SECURITY DEFINER functions without a body yet fail closed; the purge works."""

from __future__ import annotations

import uuid

import pytest
from psycopg import errors, sql

from tests.dbhelp import Conn, as_role
from tests.guards.adr0002 import SECURITY_DEFINER_FUNCTIONS

# Given their bodies by migration 0004 (tests/test_login_functions.py and the site tests), by
# migration 0006 (tests/test_pairing_functions.py, tests/test_device_functions.py) and by
# migration 0008 (tests/test_source_functions.py).
IMPLEMENTED = {
    "auth_enter_session",
    "auth_request_login",
    "auth_complete_login",
    "rate_limit_hit",
    "auth_start_pairing",
    "auth_find_pairing",
    "auth_decide_pairing",
    "auth_collect_pairing",
    "auth_enter_device",
    "auth_new_link_code",
    "auth_exchange_link_code",
    "auth_enter_source",
}
STUBS = sorted(SECURITY_DEFINER_FUNCTIONS - IMPLEMENTED - {"auth_purge_expired"})


def _call_with_nulls(conn: Conn, name: str) -> None:
    row = conn.execute(
        "SELECT pronargs FROM pg_proc WHERE proname = %s AND pronamespace = 'player'::regnamespace",
        (name,),
    ).fetchone()
    assert row is not None
    nulls = sql.SQL(", ").join([sql.NULL] * int(str(row[0])))
    conn.execute(sql.SQL("SELECT * FROM player.{}({})").format(sql.Identifier(name), nulls))


@pytest.mark.parametrize("name", STUBS)
def test_every_stub_fails_closed(su: Conn, name: str) -> None:
    as_role(su, "player_app")
    with pytest.raises(errors.FeatureNotSupported):
        _call_with_nulls(su, name)


def _account(su: Conn) -> uuid.UUID:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES ('p@example.test', decode(repeat('ab', 32), 'hex')) RETURNING id"
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _h() -> bytes:
    return uuid.uuid4().bytes * 2


def test_purge_removes_only_what_is_past_its_time(su: Conn) -> None:
    account = _account(su)
    su.execute(
        "INSERT INTO player.audit_events (account_id, event, occurred_at) VALUES "
        "(%s, 'old', now() - interval '181 days'), (%s, 'kept', now() - interval '179 days')",
        (account, account),
    )
    su.execute(
        "INSERT INTO player.sessions (account_id, token_hash, last_used_at, created_at) VALUES "
        "(%s, %s, now() - interval '15 days', now() - interval '20 days'),"
        "(%s, %s, now(), now() - interval '61 days'),"
        "(%s, %s, now(), now() - interval '30 days')",
        (account, _h(), account, _h(), account, _h()),
    )
    su.execute(
        "INSERT INTO player.devices (account_id, token_hash, name, platform, version, created_at,"
        " last_used_at, revoked_at) VALUES "
        "(%s, %s, 'revoked long ago', 'linux', '1', now() - interval '1 year', now() - interval"
        " '100 days', now() - interval '91 days'),"
        "(%s, %s, 'never used', 'linux', '1', now() - interval '25 hours', NULL, NULL),"
        "(%s, %s, 'in use', 'linux', '1', now() - interval '1 year', now(), NULL)",
        (account, _h(), account, _h(), account, _h()),
    )
    su.execute(
        "INSERT INTO player.login_links (link_hash, email, browser_hash, usable, expires_at) "
        "VALUES (%s, 'p@example.test', %s, true, now() - interval '1 second'),"
        "(%s, 'p@example.test', %s, true, now() + interval '1 minute')",
        (_h(), _h(), _h(), _h()),
    )
    as_role(su, "player_app")
    su.execute("SELECT player.auth_purge_expired()")
    su.execute("RESET ROLE")
    events = su.execute("SELECT event FROM player.audit_events").fetchall()
    assert events == [("kept",)]
    assert su.execute("SELECT count(*) FROM player.sessions").fetchone() == (1,)
    devices = su.execute("SELECT name FROM player.devices").fetchall()
    assert devices == [("in use",)]
    assert su.execute("SELECT count(*) FROM player.login_links").fetchone() == (1,)


def test_purge_needs_the_select_on_the_event_time(su: Conn) -> None:
    # The grant beyond ADR 0002's table: without it the retention delete is refused.
    su.execute("REVOKE SELECT (occurred_at) ON player.audit_events FROM player_auth")
    as_role(su, "player_app")
    with pytest.raises(errors.InsufficientPrivilege):
        su.execute("SELECT player.auth_purge_expired()")
