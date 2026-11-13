"""The account's sync order in the database (migration 0010; ADR 0002, section 7; #115): a
place is unique per account and indexed for paging, and each order starts at a base of its
own, so a cursor of one account is not a place of another."""

from __future__ import annotations

import re
import uuid

import pytest
from psycopg import errors

from player_backend.db.executor import SQL_DIR
from player_backend.sync_policy import BASE_END, BASE_MIN
from tests import sourcehelp as sh
from tests.dbhelp import Conn
from tests.sitehelp import Site

MIGRATION = "0010_sync_order.sql"
INDEX = "classes_account_sync_position"


def _account(su: Conn, email: str) -> uuid.UUID:
    row = su.execute(
        "INSERT INTO player.accounts (email, passkey_user_handle) "
        "VALUES (%s, sha256(convert_to(%s, 'UTF8'))) RETURNING id",
        (email, email),
    ).fetchone()
    assert row is not None and isinstance(row[0], uuid.UUID)
    return row[0]


def _row(su: Conn, account: uuid.UUID, class_id: str, place: int | None) -> None:
    number, kind = (0, None) if place is None else (1, "removal")
    su.execute(
        "INSERT INTO player.classes (account_id, source_id, source_class_id, "
        "publication_number, kind, published_at, sync_position) "
        "VALUES (%s, 'classbeat', %s, %s, %s, now(), %s)",
        (account, class_id, number, kind, place),
    )


def test_a_place_is_unique_within_an_account(su: Conn) -> None:
    a, b = _account(su, "a@example.test"), _account(su, "b@example.test")
    _row(su, a, "one", 7)
    # Another account may hold the same number: places are per account.
    _row(su, b, "one", 7)
    # Placeholders have no place, and any number of them may wait.
    _row(su, a, "waiting-1", None)
    _row(su, a, "waiting-2", None)
    with pytest.raises(errors.UniqueViolation), su.transaction():
        _row(su, a, "two", 7)


def test_the_index_serves_the_paging_of_one_accounts_order(su: Conn) -> None:
    (definition,) = su.execute(
        "SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i "
        "JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = %s",
        (INDEX,),
    ).fetchone() or (None,)
    assert definition == (
        f"CREATE UNIQUE INDEX {INDEX} ON player.classes USING btree (account_id, sync_position)"
    )
    a = _account(su, "a@example.test")
    for n in range(1, 50):
        _row(su, a, f"c{n}", n)
    su.execute("ANALYZE player.classes")
    su.execute("SET LOCAL enable_seqscan = off")
    plan = "\n".join(
        str(row[0])
        for row in su.execute(
            "EXPLAIN SELECT id FROM player.classes "
            "WHERE account_id = %s AND publication_number > 0 AND sync_position > %s "
            "ORDER BY sync_position LIMIT 17",
            (a, 3),
        ).fetchall()
    )
    # The order comes from the index: no sort.
    assert INDEX in plan and "Sort" not in plan


def test_a_sync_row_starts_at_its_base_and_never_below_it(su: Conn) -> None:
    a = _account(su, "a@example.test")
    with pytest.raises(errors.CheckViolation), su.transaction():
        su.execute(
            "INSERT INTO player.account_sync (account_id, base, position) VALUES (%s, 10, 9)", (a,)
        )
    with pytest.raises(errors.CheckViolation), su.transaction():
        su.execute(
            "INSERT INTO player.account_sync (account_id, base, position) VALUES (%s, -1, 0)", (a,)
        )
    # A row made as before the migration starts at 0.
    su.execute("INSERT INTO player.account_sync (account_id) VALUES (%s)", (a,))
    assert su.execute("SELECT base, position FROM player.account_sync").fetchone() == (0, 0)


def test_each_account_gets_a_random_base_at_its_first_change(site: Site) -> None:
    bases: list[int] = []
    for n, email in enumerate(("a@example.test", "b@example.test", "c@example.test")):
        site.allow(email)
        browser = site.sign_in(email, site.browser(f"198.51.100.{n + 1}"))
        token = sh.link(site, browser)
        server = sh.server(site, f"192.0.2.{n + 1}")
        answer = sh.publish(server, token, sh.envelope("one", 1, sh.document()))
        assert answer.status_code == 200
        row = site.su.execute(
            "SELECT y.base, y.position, c.sync_position FROM player.account_sync y "
            "JOIN player.accounts a ON a.id = y.account_id "
            "JOIN player.classes c ON c.account_id = y.account_id WHERE a.email = %s",
            (email,),
        ).fetchone()
        assert row is not None
        base, position, place = row
        assert isinstance(base, int) and BASE_MIN <= base < BASE_END
        # The first change takes the place right after the base.
        assert position == place == base + 1
        bases.append(base)
    assert len(set(bases)) == 3


def test_the_migration_is_additive_and_changes_no_function() -> None:
    code = re.sub(r"--[^\n]*", "", (SQL_DIR / MIGRATION).read_text(encoding="utf-8"))
    statements = [" ".join(s.split()) for s in code.split(";") if s.strip()]
    assert [" ".join(s.split()[:3]) for s in statements] == [
        "CREATE UNIQUE INDEX",
        "ALTER TABLE player.account_sync",
        "ALTER TABLE player.account_sync",
    ]
    for word in ("FUNCTION", "GRANT", "POLICY", "DROP", "REVOKE", "UPDATE", "DELETE"):
        assert word not in code.upper()
