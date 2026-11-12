"""Guard: every SQL statement is a constant of a query module, and every SQL-executing call takes
a direct reference to one (ADR 0002, section 9, item 1). An allowlist: anything else fails.
The checker's own cases below show that each rule fails, including every earlier bypass."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.guards.sql_source_check import check_source, check_tree

SRC = Path(__file__).resolve().parents[2] / "src"
QUERIES = {"player_backend.db.queries.auth": frozenset({"FIND", "LOCK"})}
DB = "player_backend/db/access.py"
OUTSIDE = "player_backend/routes.py"
QUERY_MODULE = "player_backend/db/queries/auth.py"
IMPORT = "from player_backend.db.queries import auth\n"


def _violations(snippet: str, rel: str = DB) -> list[str]:
    return [v.rule for v in check_source(snippet, rel, QUERIES)]


def test_backend_source_passes_the_guard() -> None:
    assert [str(v) for v in check_tree(SRC)] == []


def test_the_source_tree_and_its_query_modules_are_found() -> None:
    assert (SRC / "player_backend" / "db" / "queries" / "migrations.py").is_file()


@pytest.mark.parametrize(
    "snippet",
    [
        IMPORT + "conn.execute(auth.FIND, (x,))",
        IMPORT + "conn.execute(query=auth.FIND, params=(x,))",
        IMPORT + "await conn.fetch(auth.FIND, x)",
        IMPORT + "clause = text(auth.FIND)",
        "from player_backend.db.queries.auth import FIND\nconn.execute(FIND, (x,))",
        "from player_backend.db.queries.auth import FIND as F\nconn.execute(F)",
        "from .queries import auth\nconn.execute(auth.LOCK)",
        "import player_backend.db.queries.auth as a\nconn.execute(a.FIND)",
        "import player_backend.db.queries.auth\nconn.execute(player_backend.db.queries.auth.FIND)",
        "import psycopg",
        'message = f"applied {name}"',
    ],
)
def test_direct_references_to_query_constants_pass(snippet: str) -> None:
    assert _violations(snippet) == []


# Every earlier bypass and every form that is not a direct reference to a query constant.
FAILING = [
    # Earlier blocklist cases (first and second review of #32).
    ('q = f"SELECT * FROM t WHERE id = {x}"', OUTSIDE),
    ('q = "SELECT * FROM t WHERE id = %s" % x', OUTSIDE),
    ('q = "DELETE FROM t WHERE id = " + x', OUTSIDE),
    ('q = "UPDATE t SET a = {}".format(x)', OUTSIDE),
    ('q = " ".join(["SELECT a FROM t", w])', OUTSIDE),
    ("import psycopg", OUTSIDE),
    ("from sqlalchemy import text", OUTSIDE),
    ("conn.execute(query_text)", OUTSIDE),
    ("from psycopg import sql", DB),
    ("import psycopg.sql", DB),
    ('conn.execute(f"SELECT {c} FROM t")', DB),
    ('Q = "SELECT 1"\nQ = "SELECT 2"\nconn.execute(Q)', DB),
    ("def f(q):\n    conn.execute(q)", DB),
    ('q = "SELECT * FROM t WHERE id = \'"\nconn.execute(query=q + x)', DB),
    ("conn.execute(query=built)", DB),
    ("conn.execute(statement=built)", DB),
    ("conn.execute(sql=built, params=(1,))", DB),
    (IMPORT + "conn.execute(auth.FIND, query=built)", DB),
    ("conn.execute(*parts)", DB),
    (IMPORT + "conn.execute(auth.FIND, *params)", DB),
    ("conn.execute(**options)", DB),
    ("conn.execute(params=(1,))", DB),
    ('def f(x):\n    q = "DELETE FROM t WHERE id = "\n    return q + x', DB),
    ('q = "SELECT a FROM t"\nconn.execute(f"{q} WHERE id = {x}")', DB),
    ('q = "SELECT a FROM t"\nconn.execute("{} {}".format(q, x))', DB),
    ("conn.execute(text(built))", DB),
    ("conn.execute(statement=text(built))", DB),
    ("conn.execute(sql.SQL(built))", DB),
    ("conn.execute(SQL(text=built))", DB),
    ("stmt = text(built)", DB),
    ("run = conn.execute\nrun(q + x)", DB),
    ("functools.partial(conn.execute, query)", DB),
    ('getattr(conn, "execute")(q)', DB),
    ("execute(built)", DB),
    ("async def f():\n    await conn.fetch(built)", DB),
    ('Q = "SELECT a FROM t WHERE id = "\nQ += x\nconn.execute(Q)', DB),
    ('def f(x):\n    q = "DELETE FROM t WHERE id = "\n    q += x\n    return q', DB),
    ('Q = "SELECT 1"\nQ, R = x, 1\nconn.execute(Q)', DB),
    ('Q = "SELECT 1"\nfor Q in xs:\n    pass\nconn.execute(Q)', DB),
    ('Q = "SELECT 1"\nif (Q := x):\n    pass\nconn.execute(Q)', DB),
    ('Q = "SELECT 1"\nfrom m import x as Q\nconn.execute(Q)', DB),
    ('Q = "SELECT 1"\ndef f():\n    global Q\n    Q = x\nconn.execute(Q)', DB),
    ('Q = "SELECT 1"\nconn.execute(operator.add(Q, x))', DB),
    ('globals()["Q"] = x', DB),
    # Allowlist: a literal, even a constant one, is not a query constant.
    ('conn.execute("SELECT 1")', DB),
    ('Q = "SELECT a FROM t WHERE id = %s"\nconn.execute(Q, (x,))', DB),
    # Allowlist: anything but a direct reference to a query constant.
    (IMPORT + "q = auth.FIND\nconn.execute(q)", DB),
    (IMPORT + "conn.execute(auth.FIND + x)", DB),
    (IMPORT + 'conn.execute(f"{auth.FIND}")', DB),
    (IMPORT + "conn.execute(auth.FIND.replace('a', x))", DB),
    (IMPORT + "conn.execute(str(auth.FIND))", DB),
    (IMPORT + "conn.execute([auth.FIND][0])", DB),
    (IMPORT + "conn.execute(auth.FIND if a else x)", DB),
    (IMPORT + "conn.execute(auth.MISSING)", DB),
    (IMPORT + "conn.execute(text(auth.FIND + x))", DB),
    (IMPORT + "conn.execute(text(auth.FIND))", DB),
    (IMPORT + "auth = other\nconn.execute(auth.FIND)", DB),
    (IMPORT + "def f(auth):\n    conn.execute(auth.FIND)", DB),
    (IMPORT + "auth.FIND = x", DB),
    (IMPORT + 'setattr(auth, "FIND", x)', DB),
    ("from player_backend.db.queries.auth import FIND\nFIND = x\nconn.execute(FIND)", DB),
    ("from player_backend.db.queries.auth import NOPE\nconn.execute(NOPE)", DB),
    ("from player_backend.db.queries import other\nconn.execute(other.FIND)", DB),
    ("import player_backend.db.queries.auth\nconn.execute(player_backend.FIND)", DB),
    (IMPORT + "e = conn.execute\ne(auth.FIND)", DB),
    (IMPORT + "conn.execute(cursor_text(auth.FIND))", DB),
    ('exec("conn.execute(x)")', DB),
]


@pytest.mark.parametrize(("snippet", "rel"), FAILING)
def test_every_other_form_fails(snippet: str, rel: str) -> None:
    assert _violations(snippet, rel) != []


@pytest.mark.parametrize(
    "snippet",
    [
        '"""SQL."""\nfrom typing import Final\nFIND: Final[str] = "SELECT 1"',
        "from typing import Final, LiteralString\n"
        "from player_backend.db.sqlfile import sql_file\n"
        'M: Final[LiteralString] = sql_file("0001_tables.sql")',
        'from typing import Final\nFIND: Final[str] = (\n    "SELECT a "\n    "FROM t"\n)',
    ],
)
def test_a_query_module_of_constants_passes(snippet: str) -> None:
    assert _violations(snippet, QUERY_MODULE) == []


@pytest.mark.parametrize(
    "snippet",
    [
        'from typing import Final\nFIND: Final[str] = "SELECT 1"\nFIND: Final[str] = "SELECT 2"',
        'from typing import Final\nFIND: Final[str] = "SELECT 1"\nFIND += x',
        'from typing import Final\nFIND: Final[str] = "SELECT " + x',
        'from typing import Final\nFIND: Final[str] = f"SELECT {x}"',
        'from typing import Final\nFIND: Final[str] = "SELECT {}".format(x)',
        'FIND = "SELECT 1"',
        'from typing import Final\nFIND: str = "SELECT 1"',
        'from typing import Final\nfind: Final[str] = "SELECT 1"',
        "from typing import Final\nFIND: Final[str] = OTHER",
        "from typing import Final\nfrom player_backend.db.sqlfile import sql_file\n"
        "M: Final[str] = sql_file(name)",
        "from typing import Final\nfrom player_backend.db.sqlfile import sql_file\n"
        'M: Final[str] = sql_file("a.sql", x)',
        "from typing import Final\nM: Final[str] = open(p).read()",
        'import os\nfrom typing import Final\nFIND: Final[str] = "SELECT 1"',
        'from typing import Final as F\nFIND: F[str] = "SELECT 1"',
        'from typing import Final\nFIND: Final[str] = "SELECT 1"\ndef f():\n    pass',
        'from typing import Final\nFIND: Final[str] = "SELECT 1"\nprint(FIND)',
        'from typing import Final\nFIND: Final[str] = "SELECT 1"\nif x:\n    FIND = y',
        'from typing import Final\nFIND: Final[str] = "SELECT 1"\n"""late string"""',
    ],
)
def test_anything_else_in_a_query_module_fails(snippet: str) -> None:
    assert _violations(snippet, QUERY_MODULE) != []


def test_the_query_package_init_holds_a_docstring_only() -> None:
    init = "player_backend/db/queries/__init__.py"
    assert _violations('"""Query modules."""', init) == []
    assert _violations('"""Query modules."""\nFIND = "SELECT 1"', init) != []
