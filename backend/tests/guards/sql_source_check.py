"""The source guard of ADR 0002, section 9, item 1: the six rules of its list, for mistakes.

It reads the backend's source (not the tests) and fails on:

1. an import of a driver library (`DRIVERS`) outside the executor (`EXECUTOR_DIR`);
2. a use of a driver object (the driver's name, its API names in `DRIVER_NAMES`, a string equal
   to one) or of a private attribute outside the executor: any `_name` attribute of anything
   but `self` or `cls`, which covers every private attribute a handle or its transaction could
   have (they have none: a test checks it), and any `_` name or module of the executor;
3. a handle call (`HANDLE_CALLS`) outside the data-access package (`HANDLE_CALLERS`): the
   data-access modules, the migration runner and the operator's commands;
4. a query constant used other than as the direct statement argument (the first positional
   argument) of a handle call. Query modules are reached with `from <query package> import
   <module>` or `from <query module> import NAME`, so that each use can be seen;
5. a `Query` made outside a query module, a query module that holds anything but `Query`
   constants made from one literal (query_module_check.py), and SQL text anywhere else;
6. SQL text built with an f-string, `format`, `%` or `+` (and `join`).

What holds when the source is written to get round these rules is the run-time layer
(tests/test_executor_refusals.py), not this guard: see the ADR's Scope.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Mapping
from pathlib import Path

from tests.guards.query_module_check import (
    EXECUTOR,
    QUERY_DIR,
    QUERY_PACKAGE,
    Violation,
    is_query_module,
    module_name,
    package_init_violations,
    query_constants,
)

EXECUTOR_DIR = "player_backend/db/executor/"
HANDLE_CALLERS = "player_backend/db/"
# Import names of database client libraries (test_guard_sql_source.py ties it to the lockfile).
DRIVERS = frozenset(
    {
        "psycopg",
        "psycopg_binary",
        "psycopg_c",
        "psycopg_pool",
        "psycopg2",
        "asyncpg",
        "aiopg",
        "pg8000",
        "sqlalchemy",
        "sqlmodel",
        "databases",
        "sqlite3",
    }
)
# Names of the driver's API that mean nothing else in the backend.
DRIVER_NAMES = frozenset(
    {
        "execute",
        "executemany",
        "executescript",
        "exec_driver_sql",
        "callproc",
        "mogrify",
        "copy_expert",
        "fetchone",
        "fetchmany",
        "fetchall",
        "fetchrow",
        "fetchval",
        "notifies",
        "pgconn",
        "exec_",
        "exec_params",
        "send_query",
        "SQL",
        "Composed",
    }
)
HANDLE_CALLS = frozenset({"rows", "transaction"})
STATEMENT_CALLS = frozenset({"rows"})
_BUILDERS = frozenset({"format", "format_map", "join"})
_SQL = re.compile(
    r"^\s*\(?\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|GRANT|REVOKE|SET|RESET|"
    r"CALL|DO|TRUNCATE|COPY|BEGIN|COMMIT|ROLLBACK|EXECUTE|PREPARE|DECLARE|LOCK|VALUES|MERGE)\b"
    r"|\bSELECT\b.*\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\b.*\bSET\b|\bDELETE\s+FROM\b"
    r"|\bWHERE\b.*=",
    re.IGNORECASE | re.DOTALL,
)

type QueryModules = Mapping[str, frozenset[str]]


def _text(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str | bytes):
        value = node.value
        return value if isinstance(value, str) else value.decode("latin-1")
    return None


def _holds_sql(node: ast.AST) -> bool:
    return any(_SQL.search(_text(n) or "") for n in ast.walk(node))


def _docstrings(tree: ast.Module) -> set[int]:
    scopes = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    return {
        id(n.body[0].value)
        for n in ast.walk(tree)
        if isinstance(n, scopes) and n.body and isinstance(n.body[0], ast.Expr)
    }


class _Checker(ast.NodeVisitor):
    def __init__(self, rel: str, queries: QueryModules, tree: ast.Module) -> None:
        self.rel = rel
        self.queries = queries
        self.found: list[Violation] = []
        self.in_executor = rel.startswith(EXECUTOR_DIR)
        self.calls_handles = rel.startswith(HANDLE_CALLERS)
        self.docstrings = _docstrings(tree)
        self.module_aliases: dict[str, str] = {}  # local name -> query module
        self.constant_names: set[str] = set()  # local names of imported query constants
        self.allowed: set[int] = set()  # query references that are a handle call's statement
        package = module_name(rel).split(".")
        self.package = package if rel.endswith("__init__.py") else package[:-1]
        # Every import first, wherever it stands, so that a use above its import is seen too.
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                self.visit_ImportFrom(node)
        self.found.clear()

    def _add(self, node: ast.AST, rule: str) -> None:
        self.found.append(Violation(self.rel, getattr(node, "lineno", 0), rule))

    # Rules 1 and 2: the driver and the executor's private parts ---------------------------------

    def _module(self, node: ast.AST, module: str) -> None:
        if self.in_executor:
            return
        if module.split(".")[0] in DRIVERS:
            self._add(node, f"1: driver imported outside the executor: {module}")
        inside = module.removeprefix(f"{EXECUTOR}.").split(".") if module != EXECUTOR else []
        if module.startswith(EXECUTOR) and any(part.startswith("_") for part in inside):
            self._add(node, f"2: private part of the executor: {module}")

    def _name(self, node: ast.AST, name: str) -> None:
        if self.in_executor:
            return
        if name in DRIVERS or name in DRIVER_NAMES:
            self._add(node, f"2: use of a driver object: {name}")
        if name in HANDLE_CALLS and not self.calls_handles:
            self._add(node, f"3: handle call outside the data-access package: {name}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._module(node, alias.name)
            if f"{alias.name}.".startswith(f"{QUERY_PACKAGE}."):
                self._add(node, f"4: a query module is imported with `from`: {alias.name}")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        if node.level:
            base = self.package[: len(self.package) - (node.level - 1)]
            module = ".".join([*base, module] if module else base)
        self._module(node, module)
        for alias in node.names:
            full = f"{module}.{alias.name}"
            self._module(node, full)
            local = alias.asname or alias.name
            if full == QUERY_PACKAGE:
                self._add(node, "4: the query package itself is not imported")
            elif f"{module}.".startswith(f"{QUERY_PACKAGE}."):
                if full in self.queries:
                    self.module_aliases[local] = full
                elif alias.name in self.queries.get(module, ()):
                    self.constant_names.add(local)
                else:
                    self._add(node, f"4: not a query module or a query constant: {full}")

    # Rules 2, 3 and 4: names and attributes -----------------------------------------------------

    def _query_reference(self, node: ast.expr) -> bool:
        if isinstance(node, ast.Name):
            return node.id in self.constant_names
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            module = self.module_aliases.get(node.value.id)
            return module is not None and node.attr in self.queries[module]
        return False

    def visit_Attribute(self, node: ast.Attribute) -> None:
        self._name(node, node.attr)
        owner = node.value
        own = isinstance(owner, ast.Name) and owner.id in ("self", "cls")
        if node.attr.startswith("_") and not node.attr.startswith("__") and not own:
            if not self.in_executor:
                self._add(node, f"2: private attribute of another object: {node.attr}")
        if isinstance(owner, ast.Name) and owner.id in self.module_aliases:
            if id(node) not in self.allowed:
                self._add(node, f"4: not the statement of a handle call: {ast.unparse(node)}")
            return  # the owner is used as `module.NAME`, its one allowed use
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        self._name(node, node.id)
        if node.id in self.module_aliases:
            self._add(node, f"4: query module used other than as module.NAME: {node.id}")
        if node.id in self.constant_names and id(node) not in self.allowed:
            self._add(node, f"4: not the statement of a handle call: {node.id}")

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        attr = func.attr if isinstance(func, ast.Attribute) else None
        if attr in STATEMENT_CALLS and node.args and self._query_reference(node.args[0]):
            self.allowed.add(id(node.args[0]))
        if attr in ("Query", "from_file") or (isinstance(func, ast.Name) and func.id == "Query"):
            self._add(node, "5: a Query is made only in a query module")
        if attr in _BUILDERS and _holds_sql(node):
            self._add(node, f"6: SQL built with {attr}")
        self.generic_visit(node)

    # Rules 5 and 6: SQL text --------------------------------------------------------------------

    def visit_Constant(self, node: ast.Constant) -> None:
        text = _text(node)
        if text is None or id(node) in self.docstrings:
            return
        if not self.in_executor and (text in DRIVER_NAMES or text.startswith("_driver_")):
            self._add(node, f"2: string naming a driver object or a private attribute: {text!r}")
        if _SQL.search(text):
            self._add(node, "5: SQL text outside a query module")

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        if _SQL.search("".join(_text(v) or "" for v in node.values)):
            self._add(node, "6: SQL built with an f-string")
        for value in node.values:
            if isinstance(value, ast.FormattedValue):
                self.visit(value)

    def visit_BinOp(self, node: ast.BinOp) -> None:
        if isinstance(node.op, ast.Add | ast.Mod) and _holds_sql(node):
            self._add(node, "6: SQL built with + or %")
        self.generic_visit(node)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        if isinstance(node.op, ast.Add | ast.Mod) and _holds_sql(node.value):
            self._add(node, "6: SQL built with += or %=")
        self.generic_visit(node)


def check_source(source: str, rel: str, queries: QueryModules) -> list[Violation]:
    tree = ast.parse(source, filename=rel)
    if is_query_module(rel):
        return query_constants(source, rel)[1]
    if rel.startswith(QUERY_DIR):
        return package_init_violations(tree, rel)
    checker = _Checker(rel, queries, tree)
    checker.visit(tree)
    return checker.found


def source_files(src: Path) -> dict[str, str]:
    return {p.relative_to(src).as_posix(): p.read_text(encoding="utf-8") for p in src.rglob("*.py")}


def check_tree(src: Path) -> list[Violation]:
    files = source_files(src)
    queries = {
        module_name(rel): query_constants(text, rel)[0]
        for rel, text in files.items()
        if is_query_module(rel)
    }
    found: list[Violation] = []
    for rel in sorted(files):
        found.extend(check_source(files[rel], rel, queries))
    return found
