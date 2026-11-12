"""Guard: row-level security on every table, the tenant policy on every table not on the closed
list, and no other policy (ADR 0002, section 9, "Guard tests")."""

from __future__ import annotations

from tests.dbhelp import Conn
from tests.guards.adr0002 import CLOSED_TABLES, META_TABLES, SCHEMA, TENANT_TABLES

_SETTING = (
    "( SELECT (NULLIF(current_setting('app.account_id'::text, true), ''::text))::uuid"
    ' AS "nullif")'
)

_TABLES = (
    "SELECT n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity "
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND "
    "n.nspname <> ALL (ARRAY['pg_catalog', 'information_schema']) "
    "AND n.nspname !~ '^pg_(toast|temp_)'"
)
_POLICIES = (
    "SELECT n.nspname, c.relname, p.polname, p.polcmd, p.polpermissive, "
    "ARRAY(SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE r::regrole::text END "
    "      FROM unnest(p.polroles) r ORDER BY 1), "
    "pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) "
    "FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid "
    "JOIN pg_namespace n ON n.oid = c.relnamespace"
)


def _tables(su: Conn) -> list[tuple[str, str, str, bool, bool]]:
    return [
        (str(n), str(r), str(k), bool(rls), bool(force))
        for n, r, k, rls, force in su.execute(_TABLES).fetchall()
    ]


def _policies(su: Conn) -> dict[tuple[str, str], list[tuple[object, ...]]]:
    found: dict[tuple[str, str], list[tuple[object, ...]]] = {}
    for nsp, rel, *rest in su.execute(_POLICIES).fetchall():
        found.setdefault((str(nsp), str(rel)), []).append(tuple(rest))
    return found


def tenant_policy(column: str) -> tuple[object, ...]:
    expression = f"({column} = {_SETTING})"
    return ("tenant", "*", True, ["PUBLIC"], expression, expression)


def test_no_views_or_foreign_tables(su: Conn) -> None:
    # A view runs with its owner's rights and would sit beside the policies; none is allowed.
    assert [(n, r, k) for n, r, k, _, _ in _tables(su) if k not in ("r", "p")] == []


def test_every_table_has_row_level_security_enabled_and_forced(su: Conn) -> None:
    tables = _tables(su)
    assert tables, "no tables found"
    assert [(n, r) for n, r, _, rls, force in tables if not (rls and force)] == []


def test_the_adr_tables_exist(su: Conn) -> None:
    names = {(n, r) for n, r, _, _, _ in _tables(su)}
    assert {(SCHEMA, t) for t in TENANT_TABLES | CLOSED_TABLES} | META_TABLES <= names


def test_every_table_not_closed_has_exactly_the_tenant_policy(su: Conn) -> None:
    policies = _policies(su)
    wrong: list[tuple[str, str]] = []
    for nsp, rel, _, _, _ in _tables(su):
        if (nsp, rel) in META_TABLES or (nsp == SCHEMA and rel in CLOSED_TABLES):
            continue
        column = "id" if (nsp, rel) == (SCHEMA, "accounts") else "account_id"
        if policies.get((nsp, rel)) != [tenant_policy(column)]:
            wrong.append((nsp, rel))
    assert wrong == []


def test_closed_tables_have_no_policy_but_the_operators(su: Conn) -> None:
    policies = _policies(su)
    owner_only = [("operator", "*", True, ["player_owner"], "true", "true")]
    for table in CLOSED_TABLES:
        expected = owner_only if table == "signup_allowlist" else None
        assert policies.get((SCHEMA, table)) == expected, table
    for meta in META_TABLES:
        assert policies.get(meta) == [("migrator", "*", True, ["player_owner"], "true", "true")]


def test_tenant_tables_cascade_from_accounts(su: Conn) -> None:
    rows = su.execute(
        "SELECT c.relname FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid "
        "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (k.conkey) "
        "WHERE k.contype = 'f' AND k.confrelid = 'player.accounts'::regclass "
        "AND k.confdeltype = 'c' AND a.attname = 'account_id' AND a.attnotnull "
        "AND array_length(k.conkey, 1) = 1"
    ).fetchall()
    assert {str(r[0]) for r in rows} >= TENANT_TABLES - {"accounts"}
