"""ADR 0002, section 9: what player_app sees and can write, with and without an account set.

The account is set as the `auth_enter_*` functions will set it (transaction-local). These tests
check the ADR's bound and nothing stronger: player_app can set any account it knows the id of.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import LiteralString

import psycopg
import pytest
from psycopg import errors, sql

from tests.dbhelp import Conn, as_role, set_account
from tests.guards.adr0002 import CLOSED_TABLES, TENANT_TABLES


@dataclass(frozen=True)
class Seeded:
    a: uuid.UUID
    b: uuid.UUID


def _seed_account(su: Conn, email: str) -> uuid.UUID:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES (%s, decode(md5(%s) || md5(%s || 'x'), 'hex')) RETURNING id",
        (email, email, email),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    account = row[0]
    hashes = [uuid.uuid4().bytes * 2 for _ in range(4)]
    session = su.execute(
        "INSERT INTO player.sessions (account_id, token_hash) VALUES (%s, %s) RETURNING id",
        (account, hashes[0]),
    ).fetchone()
    assert session is not None
    su.execute(
        "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
        "VALUES (%s, %s, '\\x01', 'key')",
        (account, uuid.uuid4().bytes),
    )
    su.execute(
        "INSERT INTO player.passkey_registrations (account_id, session_id, challenge_hash, "
        "expires_at) VALUES (%s, %s, %s, now() + interval '5 minutes')",
        (account, session[0], hashes[1]),
    )
    su.execute(
        "INSERT INTO player.devices (account_id, token_hash, name, platform, version) "
        "VALUES (%s, %s, 'room', 'linux', '1.0')",
        (account, hashes[2]),
    )
    su.execute(
        "INSERT INTO player.source_links (account_id, source_id, token_hash) "
        "VALUES (%s, 'classbeat', %s)",
        (account, hashes[3]),
    )
    su.execute(
        "INSERT INTO player.classes (account_id, source_id, source_class_id, publication_number,"
        " kind, published_at, sync_position) VALUES (%s, 'classbeat', 'c1', 1, 'removal', now(),"
        " 1)",
        (account,),
    )
    su.execute("INSERT INTO player.account_sync (account_id, position) VALUES (%s, 1)", (account,))
    su.execute(
        "INSERT INTO player.audit_events (account_id, event) VALUES (%s, 'signed_in')", (account,)
    )
    return account


@pytest.fixture
def seeded(su: Conn) -> Iterator[Seeded]:
    yield Seeded(_seed_account(su, "a@example.test"), _seed_account(su, "b@example.test"))


_COUNTS = {
    t: sql.SQL("SELECT count(*) FROM player.{}").format(sql.Identifier(t)) for t in TENANT_TABLES
}
_OWNERS = {
    t: sql.SQL("SELECT DISTINCT {} FROM player.{}").format(
        sql.Identifier("id" if t == "accounts" else "account_id"), sql.Identifier(t)
    )
    for t in TENANT_TABLES
}


def _count(conn: Conn, table: str) -> int:
    row = conn.execute(_COUNTS[table]).fetchone()
    assert row is not None
    return int(str(row[0]))


def test_seed_holds_rows_of_both_accounts_in_every_tenant_table(su: Conn, seeded: Seeded) -> None:
    assert all(_count(su, t) == 2 for t in TENANT_TABLES)


@pytest.mark.parametrize("table", sorted(TENANT_TABLES))
def test_no_account_set_no_row_is_visible(su: Conn, seeded: Seeded, table: str) -> None:
    as_role(su, "player_app")
    assert _count(su, table) == 0


@pytest.mark.parametrize("value", ["", None])
def test_an_empty_setting_shows_nothing(su: Conn, seeded: Seeded, value: str | None) -> None:
    as_role(su, "player_app")
    if value is not None:
        su.execute("SELECT set_config('app.account_id', %s, true)", (value,))
    assert all(_count(su, t) == 0 for t in TENANT_TABLES)


def test_no_account_set_nothing_is_writable(su: Conn, seeded: Seeded) -> None:
    as_role(su, "player_app")
    assert su.execute("DELETE FROM player.accounts").rowcount == 0
    assert su.execute("DELETE FROM player.sessions").rowcount == 0
    assert su.execute("UPDATE player.classes SET publication_number = 9").rowcount == 0
    assert su.execute("UPDATE player.devices SET revoked_at = now()").rowcount == 0
    with pytest.raises(errors.InsufficientPrivilege):
        su.execute(
            "INSERT INTO player.audit_events (account_id, event) VALUES (%s, 'x')", (seeded.a,)
        )


@pytest.mark.parametrize("table", sorted(TENANT_TABLES))
def test_account_a_sees_only_its_own_rows(su: Conn, seeded: Seeded, table: str) -> None:
    as_role(su, "player_app")
    set_account(su, seeded.a)
    owners = [row[0] for row in su.execute(_OWNERS[table]).fetchall()]
    assert owners == [seeded.a]


def test_account_a_cannot_change_or_delete_b_rows(su: Conn, seeded: Seeded) -> None:
    as_role(su, "player_app")
    set_account(su, seeded.a)
    b = (seeded.b,)
    assert su.execute("DELETE FROM player.accounts WHERE id = %s", b).rowcount == 0
    assert su.execute("DELETE FROM player.sessions WHERE account_id = %s", b).rowcount == 0
    assert su.execute("DELETE FROM player.passkeys WHERE account_id = %s", b).rowcount == 0
    assert su.execute("DELETE FROM player.source_links WHERE account_id = %s", b).rowcount == 0
    assert (
        su.execute("DELETE FROM player.passkey_registrations WHERE account_id = %s", b).rowcount
        == 0
    )
    assert (
        su.execute("UPDATE player.devices SET revoked_at = now() WHERE account_id = %s", b).rowcount
        == 0
    )
    assert (
        su.execute(
            "UPDATE player.classes SET publication_number = 9 WHERE account_id = %s", b
        ).rowcount
        == 0
    )
    assert (
        su.execute("UPDATE player.account_sync SET position = 9 WHERE account_id = %s", b).rowcount
        == 0
    )
    su.execute("RESET ROLE")
    assert _count(su, "sessions") == 2 and _count(su, "classes") == 2


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT INTO player.audit_events (account_id, event) VALUES (%s, 'x')",
        "INSERT INTO player.passkeys (account_id, credential_id, public_key, name) "
        "VALUES (%s, '\\x00112233445566778899aabbccddeeff', '\\x01', 'k')",
        "INSERT INTO player.classes (account_id, source_id, source_class_id, publication_number) "
        "VALUES (%s, 'classbeat', 'c9', 0)",
        "INSERT INTO player.account_sync (account_id) VALUES (%s)",
    ],
)
def test_account_a_cannot_insert_rows_for_b(
    su: Conn, seeded: Seeded, statement: LiteralString
) -> None:
    as_role(su, "player_app")
    set_account(su, seeded.a)
    with pytest.raises(errors.InsufficientPrivilege):
        su.execute(statement, (seeded.b,))


def test_account_a_cannot_move_a_row_to_b(su: Conn, seeded: Seeded) -> None:
    as_role(su, "player_app")
    set_account(su, seeded.a)
    with pytest.raises(errors.InsufficientPrivilege):
        su.execute("UPDATE player.classes SET account_id = %s", (seeded.b,))


@pytest.mark.parametrize("table", sorted(CLOSED_TABLES))
def test_closed_tables_are_not_readable(su: Conn, seeded: Seeded, table: str) -> None:
    as_role(su, "player_app")
    set_account(su, seeded.a)
    with pytest.raises(errors.InsufficientPrivilege):
        su.execute(sql.SQL("SELECT 1 FROM player.{} LIMIT 1").format(sql.Identifier(table)))


@pytest.mark.parametrize(
    "statement", ["UPDATE player.audit_events SET event = 'x'", "DELETE FROM player.audit_events"]
)
def test_audit_events_cannot_be_changed_or_deleted(
    su: Conn, seeded: Seeded, statement: LiteralString
) -> None:
    as_role(su, "player_app")
    set_account(su, seeded.a)
    with pytest.raises(errors.InsufficientPrivilege):
        su.execute(statement)


def test_the_account_is_gone_in_the_next_transaction(db_url: str, su: Conn, seeded: Seeded) -> None:
    su.commit()  # the seed must be visible to the second connection
    try:
        with psycopg.connect(db_url) as conn:
            with conn.transaction():
                as_role(conn, "player_app")
                set_account(conn, seeded.a)
                assert _count(conn, "sessions") == 1
            with conn.transaction():
                as_role(conn, "player_app")
                assert _count(conn, "sessions") == 0
                row = conn.execute("SELECT current_setting('app.account_id', true)").fetchone()
                assert row is not None and row[0] in ("", None)
    finally:
        su.execute("DELETE FROM player.accounts WHERE id IN (%s, %s)", (seeded.a, seeded.b))
        su.commit()


def test_deleting_its_account_cascades_and_leaves_b_untouched(su: Conn, seeded: Seeded) -> None:
    as_role(su, "player_app")
    set_account(su, seeded.a)
    assert su.execute("DELETE FROM player.accounts WHERE id = %s", (seeded.a,)).rowcount == 1
    su.execute("RESET ROLE")
    assert all(_count(su, t) == 1 for t in TENANT_TABLES)
    rows = su.execute("SELECT DISTINCT account_id FROM player.audit_events").fetchall()
    assert rows == [(seeded.b,)]
