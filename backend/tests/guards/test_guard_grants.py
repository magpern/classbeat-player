"""Guard: the grants of player_app and player_auth equal ADR 0002's grant tables, and player_app
has no right on anything else (ADR 0002, section 9, "Guard tests")."""

from __future__ import annotations

from tests.dbhelp import Conn
from tests.guards.adr0002 import (
    APP_COLUMN_GRANTS,
    APP_TABLE_GRANTS,
    AUTH_COLUMN_GRANTS,
    AUTH_TABLE_GRANTS,
    CLOSED_TABLES,
    SCHEMA,
    SECURITY_DEFINER_FUNCTIONS,
)
from tests.guards.catalog import column_grants, role_oid, table_grants


def test_player_app_table_grants_equal_the_adr(su: Conn) -> None:
    assert table_grants(su, "player_app", SCHEMA) == APP_TABLE_GRANTS


def test_player_app_column_grants_equal_the_adr(su: Conn) -> None:
    assert column_grants(su, "player_app", SCHEMA) == APP_COLUMN_GRANTS


def test_player_app_audit_accounts_and_classes_named_on_their_own(su: Conn) -> None:
    # So that a later uniform grant fails even if someone also edits the table above.
    grants = table_grants(su, "player_app", SCHEMA)
    assert grants["audit_events"] == {"SELECT", "INSERT"}
    assert grants["accounts"] == {"SELECT", "DELETE"}
    assert "DELETE" not in grants["classes"]
    columns = column_grants(su, "player_app", SCHEMA)
    assert not any(table == "audit_events" for table, _ in columns)
    assert not any(table == "accounts" for table, _ in columns)


def test_player_app_has_no_grant_on_a_closed_table(su: Conn) -> None:
    tables = set(table_grants(su, "player_app", SCHEMA))
    columns = {table for table, _ in column_grants(su, "player_app", SCHEMA)}
    assert not (tables | columns) & CLOSED_TABLES


def test_player_auth_grants_equal_the_adr(su: Conn) -> None:
    assert table_grants(su, "player_auth", SCHEMA) == AUTH_TABLE_GRANTS
    assert column_grants(su, "player_auth", SCHEMA) == AUTH_COLUMN_GRANTS


def test_public_has_no_right_on_any_relation(su: Conn) -> None:
    assert table_grants(su, "PUBLIC", SCHEMA) == {}
    assert column_grants(su, "PUBLIC", SCHEMA) == {}


def test_no_role_has_truncate_references_or_trigger(su: Conn) -> None:
    rows = su.execute(
        "SELECT c.relname, a.privilege_type FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a "
        "WHERE n.nspname IN ('player', 'player_meta') AND a.grantee <> c.relowner "
        "AND a.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')"
    ).fetchall()
    assert rows == []


def test_player_app_executes_exactly_the_listed_functions(su: Conn) -> None:
    rows = su.execute(
        "SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
        "WHERE has_function_privilege(%s, p.oid, 'EXECUTE') "
        "AND n.nspname <> ALL (ARRAY['pg_catalog', 'information_schema'])",
        ("player_app",),
    ).fetchall()
    assert sorted(rows) == sorted((SCHEMA, name) for name in SECURITY_DEFINER_FUNCTIONS)


def test_player_app_schema_and_database_rights(su: Conn) -> None:
    schemas = su.execute(
        "SELECT n.nspname, a.privilege_type FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a "
        "WHERE a.grantee IN (%s, 0) AND "
        "n.nspname <> ALL (ARRAY['pg_catalog', 'information_schema']) "
        ""
        "AND n.nspname !~ '^pg_(toast|temp_)'",
        (role_oid(su, "player_app"),),
    ).fetchall()
    assert schemas == [(SCHEMA, "USAGE")]
    database = su.execute(
        "SELECT a.grantee::regrole::text, a.privilege_type FROM pg_database d, "
        "LATERAL aclexplode(d.datacl) a WHERE d.datname = current_database() "
        "AND a.grantee IN (%s, 0)",
        (role_oid(su, "player_app"),),
    ).fetchall()
    assert database == [("player_app", "CONNECT")]


def test_player_app_is_a_member_of_no_role(su: Conn) -> None:
    rows = su.execute(
        "SELECT roleid::regrole::text FROM pg_auth_members WHERE member = 'player_app'::regrole"
    ).fetchall()
    assert rows == []
