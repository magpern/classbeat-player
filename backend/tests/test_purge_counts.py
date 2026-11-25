"""`auth_purge_expired()` reports how many rows it removed per kind (#739, migration 0017),
keeps the live rows, and keeps the rights 0003 gave it. Every kind has expired and live rows,
in counts no two kinds share (#744)."""

from __future__ import annotations

import secrets
import uuid
from typing import Final, LiteralString

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


# A fresh 32-byte hash per generated row.
_HASH: Final = "sha256(convert_to(gen_random_uuid()::text, 'UTF8'))"


def _rows(
    su: Conn, table: str, columns: LiteralString, values: LiteralString, n: int, *params: object
) -> None:
    """`n` rows of `values` (a select list of the row's columns) into `table`."""
    query = sql.SQL("INSERT INTO {} ({}) SELECT {} FROM generate_series(1, {})").format(
        sql.Identifier("player", table), sql.SQL(columns), sql.SQL(values), sql.Literal(n)
    )
    su.execute(query, params)


# How many rows of each kind are past their time: no two kinds alike, so a report that swapped
# any two kinds' labels or counts would not match.
EXPIRED: dict[str, int] = dict(zip(PURGE_KINDS, range(1, len(PURGE_KINDS) + 1), strict=True))


# The kinds that go at `expires_at`: table, columns, values (the expiry an offset from now, the
# last parameter) and whether the row is an account's (its id the first parameter).
_EXPIRING: tuple[tuple[str, LiteralString, LiteralString, bool], ...] = (
    (
        "login_links",
        "link_hash, email, browser_hash, usable, expires_at",
        f"{_HASH}, 'p@example.test', {_HASH}, true, now() + %s::interval",
        False,
    ),
    (
        "login_challenges",
        "challenge_hash, browser_hash, expires_at",
        f"{_HASH}, {_HASH}, now() + %s::interval",
        False,
    ),
    (
        "pairings",
        "device_code_hash, user_code_hash, platform, version, expires_at",
        f"{_HASH}, {_HASH}, 'linux', '1', now() + %s::interval",
        False,
    ),
    (
        "source_link_codes",
        "code_hash, account_id, source_id, redirect_uri, code_challenge, expires_at",
        f"{_HASH}, %s, 'fake', 'https://example.test/cb', repeat('a', 43), now() + %s::interval",
        True,
    ),
    (
        "rate_limits",
        "key_hash, window_start, hits, expires_at",
        f"{_HASH}, now(), 1, now() + %s::interval",
        False,
    ),
    (
        "classbeat_sign_ins",
        "binding_hash, state_hash, nonce_hash, purpose, expires_at",
        f"{_HASH}, {_HASH}, {_HASH}, 'sign_in', now() + %s::interval",
        False,
    ),
    ("classbeat_event_ids", "jti_hash, expires_at", f"{_HASH}, now() + %s::interval", False),
)


def test_the_counts_are_per_kind_and_the_live_rows_stay(su: Conn) -> None:
    _purge(su)  # whatever expired before this test is gone; what follows is all there is
    before = {kind: _count(su, kind) for kind in PURGE_KINDS}
    account = _account(su)
    for kind, columns, values, owned in _EXPIRING:
        for offset, n in (("-1 second", EXPIRED[kind]), ("1 minute", 1)):
            _rows(su, kind, columns, values, n, *((account,) if owned else ()), offset)
    # Sessions go when unused for 14 days or older than 60 days, whichever comes first.
    sessions = "account_id, token_hash, last_used_at, created_at"
    unused = EXPIRED["sessions"] // 2
    session_rows: tuple[tuple[LiteralString, int], ...] = (
        (f"%s, {_HASH}, now() - interval '15 days', now() - interval '20 days'", unused),
        (f"%s, {_HASH}, now(), now() - interval '61 days'", EXPIRED["sessions"] - unused),
        (f"%s, {_HASH}, now(), now() - interval '30 days'", 1),
    )
    for values, n in session_rows:
        _rows(su, "sessions", sessions, values, n, account)
    # Devices go 90 days after they were revoked, or after 24 hours when never used.
    devices = (
        "account_id, token_hash, name, platform, version, created_at, last_used_at, revoked_at"
    )
    revoked = EXPIRED["devices"] // 2
    device_rows: tuple[tuple[LiteralString, int], ...] = (
        (
            f"%s, {_HASH}, 'revoked long ago', 'linux', '1', now() - interval '1 year',"
            " now() - interval '100 days', now() - interval '91 days'",
            revoked,
        ),
        (
            f"%s, {_HASH}, 'never used', 'linux', '1', now() - interval '25 hours', NULL, NULL",
            EXPIRED["devices"] - revoked,
        ),
        (f"%s, {_HASH}, 'in use', 'linux', '1', now() - interval '1 year', now(), NULL", 1),
    )
    for values, n in device_rows:
        _rows(su, "devices", devices, values, n, account)
    # Audit events go after 180 days.
    for age, n in (("181 days", EXPIRED["audit_events"]), ("179 days", 1)):
        _rows(
            su,
            "audit_events",
            "account_id, event, occurred_at",
            "%s, 'purge_test', now() - %s::interval",
            n,
            account,
            age,
        )
    assert _purge(su) == EXPIRED
    # One live row of each kind stays.
    assert {kind: _count(su, kind) - before[kind] for kind in PURGE_KINDS} == dict.fromkeys(
        PURGE_KINDS, 1
    )
    # Nothing is past its time any more: a second run removes nothing.
    assert _purge(su) == dict.fromkeys(PURGE_KINDS, 0)


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
