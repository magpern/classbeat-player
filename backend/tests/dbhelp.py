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
