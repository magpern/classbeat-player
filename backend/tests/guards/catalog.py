"""Catalogue reads for the guard tests. Every object outside PostgreSQL's own schemas counts."""

from __future__ import annotations

from tests.dbhelp import Conn
from tests.guards.adr0002 import ColumnGrants, TableGrants

_TABLE_GRANTS = (
    "SELECT n.nspname, c.relname, a.privilege_type "
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, "
    "LATERAL aclexplode(c.relacl) a "
    "WHERE a.grantee = %s AND n.nspname <> ALL (ARRAY['pg_catalog', 'information_schema']) "
    "AND n.nspname !~ '^pg_(toast|temp_)'"
)
_COLUMN_GRANTS = (
    "SELECT n.nspname, c.relname, att.attname, a.privilege_type "
    "FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid "
    "JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(att.attacl) a "
    "WHERE a.grantee = %s AND n.nspname <> ALL (ARRAY['pg_catalog', 'information_schema']) "
    "AND n.nspname !~ '^pg_(toast|temp_)'"
)


def role_oid(conn: Conn, role: str) -> int:
    """0 stands for PUBLIC."""
    if role == "PUBLIC":
        return 0
    row = conn.execute("SELECT oid::int FROM pg_roles WHERE rolname = %s", (role,)).fetchone()
    assert row is not None, role
    return int(str(row[0]))


def table_grants(conn: Conn, role: str, schema: str) -> TableGrants:
    """Table-level rights of `role`; a right in any schema but `schema` is keyed `schema.table`."""
    found: dict[str, set[str]] = {}
    for nsp, rel, priv in conn.execute(_TABLE_GRANTS, (role_oid(conn, role),)).fetchall():
        key = str(rel) if nsp == schema else f"{nsp}.{rel}"
        found.setdefault(key, set()).add(str(priv))
    return {k: frozenset(v) for k, v in found.items()}


def column_grants(conn: Conn, role: str, schema: str) -> ColumnGrants:
    found: dict[tuple[str, str], set[str]] = {}
    for nsp, rel, col, priv in conn.execute(_COLUMN_GRANTS, (role_oid(conn, role),)).fetchall():
        key = (str(rel) if nsp == schema else f"{nsp}.{rel}", str(col))
        found.setdefault(key, set()).add(str(priv))
    return {k: frozenset(v) for k, v in found.items()}
