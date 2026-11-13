"""Guard: the six source rules of ADR 0002, section 9, item 1 (sql_source_check.py).

Each rule has cases that must fail, the earlier reviewers' probes among them. What evasive
source can still do is the run-time layer's to refuse (tests/test_executor_refusals.py).
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

from player_backend.db.executor import QUERY_MODULES, SQL_DIR, SQL_FILES, Handle, Listener, Pool
from player_backend.db.executor._handle import _Transaction  # pyright: ignore[reportPrivateUsage]
from tests.guards.query_module_check import is_query_module, module_name
from tests.guards.sql_source_check import DRIVERS, check_source, check_tree, source_files

BACKEND = Path(__file__).resolve().parents[2]
SRC = BACKEND / "src"
QUERIES = {"player_backend.db.queries.auth": frozenset({"FIND", "LOCK"})}
DB = "player_backend/db/access.py"
EXECUTOR = "player_backend/db/executor/_handle.py"
OUTSIDE = "player_backend/routes.py"
QUERY_MODULE = "player_backend/db/queries/auth.py"
IMPORT = "from player_backend.db.queries import auth\n"
FIND = "from player_backend.db.queries.auth import FIND\n"
MAKE = "from typing import Final\nfrom player_backend.db.executor import Query\n"

# Every distribution in the lockfile, sorted into drivers and the rest: a new dependency fails
# here until someone has said which it is (and added a driver's import name to DRIVERS).
LOCKED_DRIVERS = {
    "psycopg": "psycopg",
    "psycopg-binary": "psycopg_binary",
    "psycopg-pool": "psycopg_pool",
}
LOCKED_OTHERS = frozenset(
    "annotated-doc annotated-types anyio certifi click colorama fastapi h11 httpcore httpx idna "
    "iniconfig nodeenv opentelemetry-api packaging player-backend pluggy pydantic pydantic-core "
    "pygments pyright pytest ruff starlette typing-extensions typing-inspection tzdata "
    "uvicorn "
    # The class format's validators (ADR 0003, section 4) and what they need: no database client.
    "classformat jsonschema jsonschema-specifications referencing rpds-py attrs rfc8785 "
    # The passkey check (ADR 0002, section 4): the WebAuthn library and what it needs.
    "webauthn cbor2 cryptography cffi pycparser pyopenssl pyasn1 pyasn1-modules "
    # The live WebSocket (ADR 0002, section 8): the protocol library uvicorn serves it with.
    "websockets".split()
)


def _violations(snippet: str, rel: str = DB) -> list[str]:
    return [v.rule for v in check_source(snippet, rel, QUERIES)]


def test_backend_source_passes_the_guard() -> None:
    assert [str(v) for v in check_tree(SRC)] == []


def test_the_fixed_lists_are_the_files_in_the_repository() -> None:
    modules = sorted(module_name(rel) for rel in source_files(SRC) if is_query_module(rel))
    assert modules == sorted(QUERY_MODULES)
    assert sorted(p.name for p in SQL_DIR.iterdir()) == sorted(SQL_FILES)


def test_a_handle_its_transaction_a_pool_and_a_listener_have_no_private_attribute() -> None:
    # Rule 2 forbids every `_name` attribute outside the executor. This pins that the handle
    # keeps nothing there to reach in the first place: the driver's objects are in the
    # executor's own module, not on the handle.
    for cls in (Handle, _Transaction, Pool, Listener):
        assert cls.__slots__ == ()
        private = [n for n in vars(cls) if n.startswith("_") and not n.startswith("__")]
        assert private == []


def test_every_locked_distribution_is_a_listed_driver_or_listed_as_none() -> None:
    lock = tomllib.loads((BACKEND / "uv.lock").read_text(encoding="utf-8"))
    locked = {str(package["name"]) for package in lock["package"]}
    assert locked == LOCKED_OTHERS | set(LOCKED_DRIVERS)
    assert set(LOCKED_DRIVERS.values()) <= DRIVERS


@pytest.mark.parametrize(
    ("snippet", "rel"),
    [
        (IMPORT + "db.rows(auth.FIND, (x,))", DB),
        (IMPORT + "with db.transaction():\n    found = db.rows(auth.LOCK)", DB),
        (FIND + "db.rows(FIND, (x,))", DB),
        ("from player_backend.db.queries.auth import FIND as F\ndb.rows(F)", DB),
        ("from .queries import auth\ndb.rows(auth.LOCK)", DB),
        ("from player_backend.db.queries import auth as a\ndb.rows(a.FIND)", DB),
        (
            "from player_backend.db.executor import Handle, Query\ndef f(d: Handle, q: Query): ...",
            DB,
        ),
        ("from player_backend.db.executor import Handle\ndef dep() -> Handle: ...", OUTSIDE),
        ("import re\nPATTERN = re.compile('x')", OUTSIDE),
        ("class A:\n    def f(self):\n        return self._value + type(self).__name__", OUTSIDE),
        ("def f(db):\n    return db.rows(auth.FIND)\n" + IMPORT, DB),
        ('message = f"applied {name}"', OUTSIDE),
        ("import psycopg\ncursor.execute(text, params)\ncursor.fetchall()", EXECUTOR),
    ],
)
def test_ordinary_code_passes(snippet: str, rel: str) -> None:
    assert _violations(snippet, rel) == []


FAILING = [
    # Rule 1: a driver import outside the executor, the data-access package included.
    ("import psycopg", OUTSIDE),
    ("import psycopg", DB),
    ("import psycopg_pool", DB),
    ("from psycopg_pool import ConnectionPool", OUTSIDE),
    ("from sqlalchemy import text", OUTSIDE),
    ("from psycopg import sql", DB),
    ("import psycopg.sql", DB),
    ("from psycopg import pq", DB),
    ("import psycopg.pq", DB),
    ("import asyncpg", DB),
    ("import sqlite3", OUTSIDE),
    # Rule 2: a driver object, or the private parts of a handle and of the executor.
    ("conn.execute(query_text)", DB),
    ("def f(q):\n    conn.execute(q)", DB),
    ("conn.execute(query=built)", DB),
    ("conn.execute(*parts)", DB),
    ("conn.execute(**options)", DB),
    ("ctx.conn.execute(x)", OUTSIDE),
    ("cur.connection.execute(x)", DB),
    ("pool.connection().execute(x)", DB),
    ("conn.executemany(built, rows)", DB),
    ("async def f():\n    await conn.fetchval(built)", DB),
    ("row = cur.fetchone()", DB),
    ("execute(built)", DB),
    ("run = conn.execute\nrun(q + x)", DB),
    ("functools.partial(conn.execute, query)", DB),
    ("[conn.execute][0](q)", DB),
    ('{"e": conn.execute}["e"](q)', DB),
    ("f = lambda s: conn.execute(s)", DB),
    ("psycopg.Connection.execute(conn, q)", DB),
    ("conn.execute(sql.SQL(built))", DB),
    ("stmt = SQL(built)", DB),
    ("pgconn = conn.pgconn", DB),
    ("conn.pgconn.exec_(x)", DB),
    ("conn.pgconn.send_query(x)", DB),
    ("conn.pgconn.exec_params(x, [])", DB),
    ('getattr(conn, "execute")(q)', DB),
    ('builtins.getattr(conn, "execute")(q)', DB),
    ('conn.__getattribute__("execute")(q)', DB),
    ('operator.methodcaller("execute", q)(conn)', DB),
    ('operator.attrgetter("execute")(conn)(q)', DB),
    ('type(conn).__dict__["execute"](conn, q)', DB),
    ('name = "exec_params"', DB),
    # The fifth review's probes: a handle's private methods, in the data-access package and out.
    ("conn = db._connection()", DB),
    ("conn = db._connection()\nconn.cursor().stream(text)", DB),
    ("handle._connection().cursor().copy(text)", OUTSIDE),
    ("db._close()", DB),
    ("db._close()", OUTSIDE),
    ("self.db._connection()", DB),
    ("conn = executor._handle._connections[id(db)]", DB),
    ("tx = _handle._transactions", DB),
    ("conn = db._driver_connection", DB),
    ('conn = getattr(db, "_driver_connection")', DB),
    ("tx._driver_transaction.connection", OUTSIDE),
    ("from player_backend.db.executor._query import REGISTRY", DB),
    ("from player_backend.db.executor._handle import Handle", OUTSIDE),
    ("from player_backend.db.executor import _registry", DB),
    ("import player_backend.db.executor._driver", DB),
    ("from .executor._query import registered_text", DB),
    # Rule 3: a handle call outside the data-access package.
    (IMPORT + "db.rows(auth.FIND, (x,))", OUTSIDE),
    ("with db.transaction():\n    pass", OUTSIDE),
    ("run = db.rows", OUTSIDE),
    # Rule 4: a query constant anywhere but as the direct statement argument of a handle call.
    (IMPORT + "q = auth.FIND\ndb.rows(q)", DB),
    (IMPORT + "db.rows(auth.FIND + x)", DB),
    (IMPORT + 'db.rows(f"{auth.FIND}")', DB),
    (IMPORT + "db.rows(auth.FIND.replace('a', x))", DB),
    (IMPORT + "db.rows(str(auth.FIND))", DB),
    (IMPORT + "db.rows([auth.FIND][0])", DB),
    (IMPORT + "db.rows(auth.FIND if a else x)", DB),
    (IMPORT + "db.rows(auth.MISSING)", DB),
    (IMPORT + "db.rows(x, auth.FIND)", DB),
    (IMPORT + "db.rows(query=auth.FIND)", DB),
    (IMPORT + "db.rows(*[auth.FIND])", DB),
    (IMPORT + "auth.FIND = x", DB),
    (IMPORT + 'setattr(auth, "FIND", x)', DB),
    (IMPORT + "built = auth.FIND + x", DB),
    (IMPORT + 's = f"{auth.FIND} {x}"', DB),
    (IMPORT + "F = auth.FIND\nF += x", DB),
    (IMPORT + "conn.pgconn.exec_((auth.FIND + x).encode())", DB),
    (IMPORT + "def f():\n    return auth.FIND", DB),
    (IMPORT + "log(auth.FIND)", DB),
    (IMPORT + "auth.FIND.format(x)", DB),
    (IMPORT + "s = auth.FIND % x", DB),
    (IMPORT + "helper(auth)", DB),
    (IMPORT + "m = auth\ndb.rows(m.FIND)", DB),
    (IMPORT + "db.rows(auth.FIND)\nother(auth.FIND)", DB),
    ("def f():\n    return auth.FIND + x\n" + IMPORT, DB),
    ("def f():\n    from player_backend.db.queries import auth\n    return auth.FIND", DB),
    (IMPORT + "STEPS = [(1, auth.FIND)]", DB),
    (FIND + "kept = FIND", DB),
    (FIND + "db.rows(FIND + x)", DB),
    (FIND + "len(FIND)", DB),
    (FIND + "FIND = x\ndb.rows(FIND)", DB),
    ("from player_backend.db.queries.auth import NOPE\ndb.rows(NOPE)", DB),
    ("from player_backend.db.queries import other\ndb.rows(other.FIND)", DB),
    ("from player_backend.db.queries import *", DB),
    ("from player_backend.db.queries.auth import *", DB),
    ("from player_backend.db import queries\ndb.rows(queries.auth.FIND)", DB),
    ("from . import queries", DB),
    ("import player_backend.db.queries.auth\ndb.rows(player_backend.db.queries.auth.FIND)", DB),
    ("import player_backend.db.queries.auth as a\ndb.rows(a.FIND)", DB),
    ("import player_backend.db.queries", DB),
    # Rule 5: a Query made outside a query module, and SQL text outside one.
    (MAKE + 'FIND: Final[Query] = Query("SELECT 1")', DB),
    ('q = Query("SELECT 1")', OUTSIDE),
    ("q = Query(built)", DB),
    ('q = Query.from_file("0001_tables.sql")', DB),
    ('q = executor.Query("SELECT 1")', DB),
    ('q = Query("SELECT 1")', EXECUTOR),
    ('db.rows("SELECT 1")', DB),
    ('Q = "SELECT a FROM t WHERE id = %s"\ndb.rows(Q, (x,))', DB),
    ('Q = "SELECT 1"\nQ = "SELECT 2"', DB),
    ('Q = b"DELETE FROM t"', OUTSIDE),
    # Rule 6: SQL text built with an f-string, format, % or +.
    ('q = f"SELECT * FROM t WHERE id = {x}"', OUTSIDE),
    ('q = "SELECT * FROM t WHERE id = %s" % x', OUTSIDE),
    ('q = "DELETE FROM t WHERE id = " + x', OUTSIDE),
    ('q = "UPDATE t SET a = {}".format(x)', OUTSIDE),
    ('q = " ".join(["SELECT a FROM t", w])', OUTSIDE),
    ('db.rows(f"SELECT {c} FROM t")', DB),
    ('q = f"SELECT {c} FROM t"', EXECUTOR),
    ('q = "SELECT * FROM t WHERE id = \'"\nconn.execute(query=q + x)', DB),
    ('def f(x):\n    q = "DELETE FROM t WHERE id = "\n    return q + x', DB),
    ('q = "SELECT a FROM t"\ns = f"{q} WHERE id = {x}"', DB),
    ('q = "SELECT a FROM t"\ns = "{} {}".format(q, x)', DB),
    ('Q = "SELECT a FROM t WHERE id = "\nQ += x', DB),
    ('def f(x):\n    q = "DELETE FROM t WHERE id = "\n    q += x\n    return q', DB),
    ('q = base\nq += " WHERE id = " + x', DB),
    ('Q = "SELECT 1"\ns = operator.add(Q, x)', DB),
]


@pytest.mark.parametrize(("snippet", "rel"), FAILING)
def test_every_broken_rule_fails(snippet: str, rel: str) -> None:
    assert _violations(snippet, rel) != []


@pytest.mark.parametrize(
    ("snippet", "rule"),
    [
        ("import psycopg", "1"),
        ("conn.execute(x)", "2"),
        ("db._driver_connection", "2"),
        ("db._connection", "2"),
        (IMPORT + "db.rows(auth.FIND)", "3"),
        (IMPORT + "s = auth.FIND", "4"),
        ("q = Query(x)", "5"),
        ("q = f'{y} WHERE a = {x}'", "6"),
    ],
)
def test_each_rule_is_the_one_that_fails(snippet: str, rule: str) -> None:
    assert [v.split(":")[0] for v in _violations(snippet, OUTSIDE)] == [rule]


@pytest.mark.parametrize(
    "snippet",
    [
        '"""SQL."""\n' + MAKE + 'FIND: Final[Query] = Query("SELECT 1")',
        MAKE + 'M: Final[Query] = Query.from_file("0001_tables.sql")',
        MAKE + 'FIND: Final[Query] = Query(\n    "SELECT a "\n    "FROM t"\n)',
    ],
)
def test_a_query_module_of_query_constants_passes(snippet: str) -> None:
    assert _violations(snippet, QUERY_MODULE) == []


@pytest.mark.parametrize(
    "snippet",
    [
        MAKE + 'FIND: Final[Query] = Query("SELECT 1")\nFIND: Final[Query] = Query("SELECT 2")',
        MAKE + 'FIND: Final[Query] = Query("SELECT " + x)',
        MAKE + 'FIND: Final[Query] = Query(f"SELECT {x}")',
        MAKE + 'FIND: Final[Query] = Query("SELECT {}".format(x))',
        MAKE + 'FIND: Final[Query] = Query("SELECT %s" % x)',
        MAKE + "FIND: Final[Query] = Query(OTHER)",
        MAKE + 'FIND: Final[Query] = Query("SELECT 1", x)',
        MAKE + "M: Final[Query] = Query.from_file(name)",
        MAKE + 'M: Final[Query] = Query.from_file("a.sql", x)',
        MAKE + "M: Final[Query] = Query(open(p).read())",
        MAKE + 'FIND = Query("SELECT 1")',
        MAKE + 'FIND: Query = Query("SELECT 1")',
        MAKE + 'find: Final[Query] = Query("SELECT 1")',
        MAKE + 'FIND: Final[str] = "SELECT 1"',
        MAKE + 'FIND: Final[Query] = Query("SELECT 1")\nFIND += x',
        MAKE + 'FIND: Final[Query] = Query("SELECT 1")\ndef f():\n    pass',
        MAKE + 'FIND: Final[Query] = Query("SELECT 1")\nprint(FIND)',
        MAKE + 'FIND: Final[Query] = Query("SELECT 1")\nif x:\n    FIND = y',
        MAKE + 'FIND: Final[Query] = Query("SELECT 1")\n"""late string"""',
        "import os\n" + MAKE + 'FIND: Final[Query] = Query("SELECT 1")',
        "import psycopg\n" + MAKE + 'FIND: Final[Query] = Query("SELECT 1")',
        "from typing import Final as F\nFIND: F[Query] = Query('SELECT 1')",
        "from player_backend.db.executor import Query as Q\nFIND: Final[Q] = Q('SELECT 1')",
    ],
)
def test_anything_else_in_a_query_module_fails(snippet: str) -> None:
    assert _violations(snippet, QUERY_MODULE) != []


def test_the_query_package_init_holds_a_docstring_and_the_executors_import() -> None:
    init = "player_backend/db/queries/__init__.py"
    assert _violations('"""Query modules."""\nimport player_backend.db.executor', init) == []
    assert _violations('"""Query modules."""', init) == []
    assert _violations('"""Query modules."""\nFIND = "SELECT 1"', init) != []
    assert _violations('"""Query modules."""\nimport psycopg', init) != []
