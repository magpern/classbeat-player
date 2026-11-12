"""Guard: no SQL built from strings in backend/src, and no database call outside the data-access
package (ADR 0002, section 9, item 1). The checker's own cases show each rule fails."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.guards.sql_source_check import check_source, check_tree

SRC = Path(__file__).resolve().parents[2] / "src"


def test_backend_source_has_no_string_built_sql() -> None:
    assert [str(v) for v in check_tree(SRC)] == []


def test_the_source_tree_is_found() -> None:
    assert (SRC / "player_backend" / "db" / "migrate.py").is_file()


@pytest.mark.parametrize(
    ("snippet", "rule"),
    [
        ('q = f"SELECT * FROM t WHERE id = {x}"', "f-string"),
        ('q = "SELECT * FROM t WHERE id = %s" % x', "% or +"),
        ('q = "DELETE FROM t WHERE id = " + x', "% or +"),
        ('q = "UPDATE t SET a = {}".format(x)', "str.format"),
        ('q = " ".join(["SELECT a FROM t", w])', "str.join"),
        ("import psycopg", "driver imported outside"),
        ("from sqlalchemy import text", "driver imported outside"),
        ("conn.execute(query_text)", "not a constant"),
    ],
)
def test_each_rule_fails_outside_the_data_access_package(snippet: str, rule: str) -> None:
    found = check_source(snippet, "player_backend/routes.py")
    assert any(rule in v.rule for v in found), found


@pytest.mark.parametrize(
    ("snippet", "rule"),
    [
        ("from psycopg import sql", "composition"),
        ("import psycopg.sql", "composition"),
        ('conn.execute(f"SELECT {c} FROM t")', "f-string"),
        ('Q = "SELECT 1"\nQ = "SELECT 2"\nconn.execute(Q)', "not a constant"),
        ("def f(q):\n    conn.execute(q)", "not a constant"),
    ],
)
def test_each_rule_fails_inside_the_data_access_package(snippet: str, rule: str) -> None:
    found = check_source(snippet, "player_backend/db/queries.py")
    assert any(rule in v.rule for v in found), found


@pytest.mark.parametrize(
    "snippet",
    [
        'Q = "SELECT a FROM t WHERE id = %s"\nconn.execute(Q, (x,))',
        'conn.execute("SELECT a FROM t WHERE id = %s", (x,))',
        "import psycopg",
        'message = f"applied {name}"',
    ],
)
def test_constant_statements_with_bound_parameters_pass(snippet: str) -> None:
    assert check_source(snippet, "player_backend/db/queries.py") == []


def test_the_trusted_migration_statement_is_exempt_only_in_the_runner() -> None:
    snippet = "conn.execute(migration.body)"
    assert check_source(snippet, "player_backend/db/migrate.py") == []
    assert check_source(snippet, "player_backend/db/queries.py") != []
