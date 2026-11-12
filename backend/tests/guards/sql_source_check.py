"""Static check of the backend's source (ADR 0002, section 9, item 1). An allowlist.

1. **Query modules** (`player_backend/db/queries/*.py`) hold every SQL statement as upper-case
   `Final` constants, each bound once from one string literal or `sql_file("<literal>.sql")`,
   and nothing else (query_module_check.py).
2. **Every SQL call** (`SQL_CALLS`: `execute`, `executemany`, `fetch`, `text()`, `sql.SQL()`, ...
   by attribute or by name) takes as its SQL argument (the first positional argument, or a
   statement keyword) a direct reference to a query constant: `module.NAME` for a query module
   imported here with `from ... import`, or a `NAME` imported from one. Nothing else passes: no
   literal, variable, f-string, concatenation, call, subscript or alias. `*args`, `**kwargs` and
   a call without its SQL argument fail.
3. **A query constant is used only there.** Outside query modules, a reference to a query
   constant anywhere but as the direct SQL argument of a SQL call fails: as an operand, in an
   f-string, with `.format` or another method, assigned, augmented, passed to any other call or
   returned. A query module's local name is used only as the owner of `module.NAME`.
4. **Bindings.** A name that refers to a query module or constant is bound once in its file. A
   query module is reached only by `from <query package> import <module> [as x]` or
   `from <query module> import NAME [as x]`: a plain `import player_backend...`, importing a
   package that contains the query modules, binding the name `player_backend` and assigning to
   an attribute of a query module all fail.
5. **No indirection.** A SQL call used other than by calling it at once (an alias,
   `functools.partial`), psycopg's libpq layer (`pgconn`, `exec_`, `send_query`, ... in
   `LIBPQ`), any string equal to the name of a SQL call, a libpq name or a forbidden name
   (`methodcaller("execute")`, `__getattribute__("execute")`, ...), and the names in
   `FORBIDDEN_NAMES` (`getattr`, `setattr`, `globals`, `exec`, `eval`, `__import__`,
   `import_module`, ...), `sys.modules` and any import of `importlib` fail.
6. **SQL-looking literals** appear only in query modules. A pattern, so a backstop only: it can
   be split ("SEL" + "ECT"); rules 2 and 3 do not depend on it.
7. A database driver is imported only in `player_backend/db/`; psycopg's SQL composition and
   libpq layer never.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Mapping
from pathlib import Path

from tests.guards.query_module_check import (
    QUERY_DIR,
    QUERY_PACKAGE,
    Violation,
    is_query_module,
    module_name,
    package_init_violations,
    query_constants,
    store_names,
)

DATA_ACCESS = "player_backend/db/"
DRIVERS = ("psycopg", "psycopg2", "psycopg_pool", "asyncpg", "sqlalchemy", "pg8000", "databases")
FORBIDDEN_MODULES = ("psycopg.sql", "psycopg2.sql", "psycopg.pq", "importlib")
# Calls that run or wrap SQL text. Generic names are listed on purpose: a false alarm is fixed
# by renaming, a missed one is a hole.
SQL_CALLS = frozenset(
    {
        "execute",
        "executemany",
        "executescript",
        "exec_driver_sql",
        "copy",
        "copy_expert",
        "copy_from",
        "copy_to",
        "stream",
        "mogrify",
        "callproc",
        "cursor_execute",
        "fetch",
        "fetchrow",
        "fetchval",
        "text",
        "SQL",
        "Composed",
        "Literal",
        "literal_column",
        "TextClause",
    }
)
# psycopg's libpq layer and its relatives: never used by the backend, under any name.
LIBPQ = frozenset(
    {
        "pgconn",
        "pq",
        "PGconn",
        "exec_",
        "send_query",
        "exec_params",
        "send_query_params",
        "prepare",
        "send_prepare",
        "exec_prepared",
        "send_query_prepared",
        "describe_prepared",
        "describe_portal",
        "send_describe_prepared",
        "send_describe_portal",
    }
)
FORBIDDEN_NAMES = frozenset(
    {
        "globals",
        "locals",
        "vars",
        "getattr",
        "setattr",
        "delattr",
        "exec",
        "eval",
        "__import__",
        "import_module",
        "__getattribute__",
        "methodcaller",
        "attrgetter",
    }
)
# Builtins forbidden by name only (`re.compile` is fine, the builtin `compile` is not).
FORBIDDEN_BUILTINS = frozenset({"compile", "breakpoint"})
NAMED_STRINGS = SQL_CALLS | LIBPQ | FORBIDDEN_NAMES | FORBIDDEN_BUILTINS
STATEMENT_KEYWORDS = frozenset(
    {"query", "statement", "sql", "operation", "stmt", "command", "text", "obj", "procname"}
)
_SQL = re.compile(
    r"^\s*\(?\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|GRANT|REVOKE|SET|RESET|"
    r"CALL|DO|TRUNCATE|COPY|BEGIN|COMMIT|ROLLBACK|EXECUTE|PREPARE|DECLARE|LOCK|VALUES|MERGE)\b"
    r"|\bSELECT\b.*\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\b.*\bSET\b|\bDELETE\s+FROM\b"
    r"|\bWHERE\b.*=",
    re.IGNORECASE | re.DOTALL,
)
_ROOT = QUERY_PACKAGE.split(".")[0]
# Packages that contain the query modules: importing one would give a way round rule 4.
_CONTAINERS = frozenset(".".join(QUERY_PACKAGE.split(".")[:i]) for i in range(1, 4))

type QueryModules = Mapping[str, frozenset[str]]


def _call_name(func: ast.expr) -> str | None:
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return None


def _docstring_ids(tree: ast.Module) -> set[int]:
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                ids.add(id(body[0].value))
    return ids


def _forbidden_module(module: str) -> bool:
    return any(module == m or module.startswith(f"{m}.") for m in FORBIDDEN_MODULES)


class _Checker(ast.NodeVisitor):
    def __init__(self, rel: str, queries: QueryModules, tree: ast.Module) -> None:
        self.rel = rel
        self.queries = queries
        self.found: list[Violation] = []
        self.called: set[int] = {id(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
        self.docstrings = _docstring_ids(tree)
        self.counts = store_names(tree)
        # Local name -> query module, and local name -> (query module, constant).
        self.module_aliases: dict[str, str] = {}
        self.constant_names: dict[str, tuple[str, str]] = {}
        # Query-constant references that are the direct SQL argument of a SQL call.
        self.allowed: set[int] = set()
        self.package = module_name(rel)
        if not rel.endswith("__init__.py"):
            self.package = self.package.rsplit(".", 1)[0] if "." in self.package else ""

    def _add(self, node: ast.AST, rule: str) -> None:
        self.found.append(Violation(self.rel, getattr(node, "lineno", 0), rule))

    # Imports (rules 4, 5 and 7) --------------------------------------------------------------

    def _check_module(self, node: ast.AST, module: str) -> None:
        if _forbidden_module(module):
            self._add(node, f"forbidden module imported: {module}")
        if module.split(".")[0] in DRIVERS and not self.rel.startswith(DATA_ACCESS):
            self._add(node, f"database driver imported outside {DATA_ACCESS}: {module}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_module(node, alias.name)
            if alias.name.split(".")[0] == _ROOT:
                self._add(node, f"plain import of the backend's own package: {alias.name}")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        if node.level:
            base = self.package.split(".") if self.package else []
            base = base[: len(base) - (node.level - 1)] if node.level > 1 else base
            module = ".".join([*base, module] if module else base)
        self._check_module(node, module)
        for alias in node.names:
            full = f"{module}.{alias.name}"
            self._check_module(node, full)
            local = alias.asname or alias.name
            if alias.name == "*":
                self._add(node, f"star import: {module}")
            elif full in _CONTAINERS:
                self._add(node, f"import of a package holding the query modules: {full}")
            elif full in self.queries:
                self.module_aliases[local] = full
            elif module in self.queries:
                if alias.name not in self.queries[module]:
                    self._add(node, f"not a query constant: {full}")
                self.constant_names[local] = (module, alias.name)
            elif module == QUERY_PACKAGE or module.startswith(f"{QUERY_PACKAGE}."):
                self._add(node, f"not a query module: {full}")

    # References (rules 2 and 3) ---------------------------------------------------------------

    def _query_reference(self, node: ast.expr) -> bool:
        if isinstance(node, ast.Name):
            return node.id in self.constant_names
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            module = self.module_aliases.get(node.value.id)
            return module is not None and node.attr in self.queries[module]
        return False

    # Visitors ---------------------------------------------------------------------------------

    def visit_Constant(self, node: ast.Constant) -> None:
        value = node.value
        if not isinstance(value, str | bytes) or id(node) in self.docstrings:
            return
        text = value if isinstance(value, str) else value.decode("latin-1")
        if text in NAMED_STRINGS:
            self._add(node, f"string naming a SQL call or a forbidden name: {text!r}")
        if _SQL.search(text):
            self._add(node, "SQL text outside a query module")

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        parts = "".join(str(v.value) for v in node.values if isinstance(v, ast.Constant))
        if _SQL.search(parts):
            self._add(node, "SQL text outside a query module (f-string)")
        for value in node.values:
            if isinstance(value, ast.FormattedValue):
                self.visit(value)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        owner = node.value
        if node.attr in SQL_CALLS and id(node) not in self.called:
            self._add(node, f"SQL call not called at once: {ast.unparse(node)}")
        if node.attr in LIBPQ or node.attr in FORBIDDEN_NAMES:
            self._add(node, f"forbidden name: {ast.unparse(node)}")
        if isinstance(owner, ast.Name) and owner.id == "sys" and node.attr == "modules":
            self._add(node, "sys.modules is not allowed")
        if isinstance(owner, ast.Name) and owner.id in self.module_aliases:
            if not isinstance(node.ctx, ast.Load):
                self._add(node, f"assignment to a query module: {ast.unparse(node)}")
            elif node.attr not in self.queries[self.module_aliases[owner.id]]:
                self._add(node, f"not a query constant: {ast.unparse(node)}")
            elif id(node) not in self.allowed:
                self._add(node, f"query constant used outside a SQL call: {ast.unparse(node)}")
            return  # the owner is used as `module.NAME`, which is its one allowed use
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        load = isinstance(node.ctx, ast.Load)
        if node.id in SQL_CALLS and id(node) not in self.called and load:
            self._add(node, f"SQL call not called at once: {node.id}")
        if node.id in LIBPQ or node.id in FORBIDDEN_NAMES or node.id in FORBIDDEN_BUILTINS:
            self._add(node, f"forbidden name: {node.id}")
        if node.id == _ROOT:
            self._add(node, f"the name {_ROOT} is not used in backend source")
        if load and node.id in self.module_aliases:
            self._add(node, f"query module used other than as module.NAME: {node.id}")
        if load and node.id in self.constant_names and id(node) not in self.allowed:
            self._add(node, f"query constant used outside a SQL call: {node.id}")

    def visit_Module(self, node: ast.Module) -> None:
        self.generic_visit(node)
        for name in sorted({*self.module_aliases, *self.constant_names}):
            if self.counts.get(name, 0) != 1:
                self._add(node, f"query name bound more than once: {name}")
        if self.counts.get(_ROOT):
            self._add(node, f"the name {_ROOT} is bound")

    def visit_Call(self, node: ast.Call) -> None:
        if _call_name(node.func) in SQL_CALLS:
            self._check_sql_call(node)
        self.generic_visit(node)

    def _check_sql_call(self, node: ast.Call) -> None:
        statements: list[ast.expr] = []
        for arg in node.args[:1]:
            if isinstance(arg, ast.Starred):
                self._add(node, "SQL argument passed with *args")
                return
            statements.append(arg)
        for keyword in node.keywords:
            if keyword.arg is None:
                self._add(node, "arguments passed with **kwargs")
                return
            if keyword.arg in STATEMENT_KEYWORDS:
                statements.append(keyword.value)
        if any(isinstance(a, ast.Starred) for a in node.args):
            self._add(node, "arguments passed with *args")
        if not statements:
            self._add(node, f"SQL call without its SQL argument: {ast.unparse(node)[:60]}")
        for statement in statements:
            if self._query_reference(statement):
                self.allowed.add(id(statement))
            else:
                self._add(node, f"SQL argument is not a query constant: {ast.unparse(statement)}")


def check_source(source: str, rel: str, queries: QueryModules) -> list[Violation]:
    tree = ast.parse(source, filename=rel)
    if is_query_module(rel):
        return query_constants(source, rel)[1]
    if rel.startswith(QUERY_DIR):
        return package_init_violations(tree, rel)
    checker = _Checker(rel, queries, tree)
    checker.visit(tree)
    return checker.found


def check_tree(src: Path) -> list[Violation]:
    files = {
        p.relative_to(src).as_posix(): p.read_text(encoding="utf-8") for p in src.rglob("*.py")
    }
    queries = {
        module_name(rel): query_constants(text, rel)[0]
        for rel, text in files.items()
        if is_query_module(rel)
    }
    found: list[Violation] = []
    for rel in sorted(files):
        found.extend(check_source(files[rel], rel, queries))
    return found
