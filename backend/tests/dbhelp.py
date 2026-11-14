"""Helpers for database tests (fixtures are in conftest.py)."""

from __future__ import annotations

import psycopg
from psycopg import sql

ROLES = ("player_app", "player_auth", "player_owner")

type Conn = psycopg.Connection[tuple[object, ...]]


def as_role(conn: Conn, role: str) -> None:
    """Act as `role` for the rest of the current transaction (grants and policies included)."""
    assert role in ROLES
    conn.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(role)))


def set_account(conn: Conn, account_id: object) -> None:
    """What an `auth_enter_*` function does once it has checked a credential (ADR 0002, s. 9)."""
    conn.execute("SELECT set_config('app.account_id', %s, true)", (str(account_id),))


def every_value(conn: Conn) -> str:
    """Every row of every table of the backend's schemas, as text (to search for a value that
    must be kept nowhere)."""
    tables = conn.execute(
        "SELECT table_schema, table_name FROM information_schema.tables "
        "WHERE table_type = 'BASE TABLE' "
        "AND table_schema NOT IN ('pg_catalog', 'information_schema')"
    ).fetchall()
    assert tables
    dumped: list[str] = []
    for schema, table in tables:
        query = sql.SQL("SELECT t::text FROM {}.{} t").format(
            sql.Identifier(str(schema)), sql.Identifier(str(table))
        )
        dumped += [str(row[0]) for row in conn.execute(query).fetchall()]
    return "\n".join(dumped)
