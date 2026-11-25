"""`auth_purge_expired()` reports how many rows it removed per kind (#739, migration 0017),
keeps the live rows, and keeps the rights 0003 gave it."""

from __future__ import annotations

import secrets
import uuid

from psycopg import sql

from player_backend.db.operator import PURGE_KINDS
from tests.dbhelp import Conn, as_role


def _h() -> bytes:
    return secrets.token_bytes(32)


def _purge(su: Conn) -> dict[str, int]:
    as_role(su, "player_app")
    rows = su.execute("SELECT kind, removed FROM player.auth_purge_expired()").fetchall()
    su.execute("RESET ROLE")
    counts: dict[str, int] = {}
    for kind, removed in rows:
        assert isinstance(kind, str) and isinstance(removed, int)
        counts[kind] = removed
    assert tuple(counts) == PURGE_KINDS
    return counts


def _account(su: Conn) -> uuid.UUID:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) VALUES (%s, %s) RETURNING id",
        (f"purge-{secrets.token_hex(4)}@example.test", _h()),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _count(su: Conn, table: str) -> int:
    query = sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier("player", table))
    row = su.execute(query).fetchone()
    assert row is not None and isinstance(row[0], int)
    return row[0]


def test_the_counts_are_per_kind_and_the_live_rows_stay(su: Conn) -> None:
    _purge(su)  # whatever expired before this test is gone; what follows is all there is
    before = {kind: _count(su, kind) for kind in PURGE_KINDS}
    account = _account(su)
    su.execute(
        "INSERT INTO player.login_links (link_hash, email, browser_hash, usable, expires_at) "
        "VALUES (%s, 'p@example.test', %s, true, now() - interval '1 second'),"
        "(%s, 'p@example.test', %s, true, now() - interval '1 hour'),"
        "(%s, 'p@example.test', %s, true, now() + interval '1 minute')",
        (_h(), _h(), _h(), _h(), _h(), _h()),
    )
    su.execute(
        "INSERT INTO player.login_challenges (challenge_hash, browser_hash, expires_at) VALUES "
        "(%s, %s, now() - interval '1 second'), (%s, %s, now() + interval '1 minute')",
        (_h(), _h(), _h(), _h()),
    )
    su.execute(
        "INSERT INTO player.rate_limits (key_hash, window_start, hits, expires_at) VALUES "
        "(%s, now(), 1, now() - interval '1 minute'), (%s, now(), 1, now() - interval '2 hours'),"
        "(%s, now(), 1, now() - interval '1 day'), (%s, now(), 1, now() + interval '1 hour')",
        (_h(), _h(), _h(), _h()),
    )
    su.execute(
        "INSERT INTO player.classbeat_event_ids (jti_hash, expires_at) VALUES "
        "(%s, now() - interval '1 second'), (%s, now() + interval '8 days')",
        (_h(), _h()),
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
        "INSERT INTO player.audit_events (account_id, event, occurred_at) VALUES "
        "(%s, 'old', now() - interval '181 days'), (%s, 'kept', now() - interval '179 days')",
        (account, account),
    )
    expected = {kind: 0 for kind in PURGE_KINDS} | {
        "login_links": 2,
        "login_challenges": 1,
        "rate_limits": 3,
        "classbeat_event_ids": 1,
        "sessions": 2,
        "devices": 2,
        "audit_events": 1,
    }
    assert _purge(su) == expected
    live = {"login_links": 1, "login_challenges": 1, "rate_limits": 1, "classbeat_event_ids": 1}
    live |= {"sessions": 1, "devices": 1, "audit_events": 1}
    assert {kind: _count(su, kind) - before[kind] for kind in PURGE_KINDS} == {
        kind: live.get(kind, 0) for kind in PURGE_KINDS
    }
    # Nothing is past its time any more: a second run removes nothing.
    assert _purge(su) == {kind: 0 for kind in PURGE_KINDS}


def test_the_rights_are_those_of_0003(su: Conn) -> None:
    # Owner, SECURITY DEFINER, search_path, and an ACL of the owner and player_app alone: as
    # 0003 set them for the function 0017 replaces (the guards check the rest of the list).
    row = su.execute(
        "SELECT p.proowner::regrole::text, p.prosecdef, p.proconfig, "
        "ARRAY(SELECT a.grantee::regrole::text || ':' || a.privilege_type || ':' "
        "|| a.grantor::regrole::text FROM aclexplode(p.proacl) a ORDER BY 1), "
        "pg_get_function_result(p.oid) "
        "FROM pg_proc p WHERE p.oid = 'player.auth_purge_expired()'::regprocedure"
    ).fetchone()
    assert row == (
        "player_auth",
        True,
        ["search_path=pg_catalog, player, pg_temp"],
        ["player_app:EXECUTE:player_auth", "player_auth:EXECUTE:player_auth"],
        "TABLE(kind text, removed bigint)",
    )
