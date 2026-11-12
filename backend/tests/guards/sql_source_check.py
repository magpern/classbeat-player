"""Static check of the backend's source (ADR 0002, section 9, item 1). An allowlist.

1. **Query modules** (`player_backend/db/queries/*.py`) hold every SQL statement. A query module
   contains only a docstring, the imports `from typing import Final, LiteralString` (or a part
   of them) and `from player_backend.db.sqlfile import sql_file`, and constants
   `NAME: Final[...] = <one string literal>` or `= sql_file("<literal>.sql")`, upper-case names,
   each bound exactly once. Anything else fails.
2. **Every SQL-executing call** (`execute`, `executemany`, `fetch`, `text()`, `sql.SQL()`, ... by
   attribute or by name, see `SQL_CALLS`) takes as its SQL argument (the first positional
   argument, or a statement keyword) a direct reference to a query constant: `module.NAME` for
   a query module imported in this file, or a `NAME` imported from one. Nothing else passes: no
   literal, local variable, f-string, concatenation, call, subscript or alias. `*args`,
   `**kwargs` and a call without its SQL argument fail.
3. A SQL-executing name used other than by calling it at once (an alias, `functools.partial`)
   fails, as does `getattr` for one, and `globals`, `setattr`, `vars`, `exec`, `eval`, ... .
4. A name or module alias that refers to a query module or constant is bound once in its file;
   no assignment to an attribute of a query module.
5. SQL-looking string literals appear only in query modules.
6. A database driver is imported only in `player_backend/db/`; psycopg's SQL composition never.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DATA_ACCESS = "player_backend/db/"
QUERY_PACKAGE = "player_backend.db.queries"
QUERY_DIR = "player_backend/db/queries/"
DRIVERS = ("psycopg", "psycopg2", "psycopg_pool", "asyncpg", "sqlalchemy", "pg8000", "databases")
COMPOSITION = ("psycopg.sql", "psycopg2.sql")
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
        "prepare",
        "text",
        "SQL",
        "Composed",
        "Literal",
        "literal_column",
        "TextClause",
    }
)
STATEMENT_KEYWORDS = frozenset(
    {"query", "statement", "sql", "operation", "stmt", "command", "text", "obj", "procname"}
)
FORBIDDEN_CALLS = frozenset(
    {"globals", "locals", "vars", "setattr", "delattr", "exec", "eval", "compile", "__import__"}
)
_ALLOWED_QUERY_IMPORTS = {
    "typing": frozenset({"Final", "LiteralString"}),
    "player_backend.db.sqlfile": frozenset({"sql_file"}),
}
_CONSTANT_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
_SQL = re.compile(
    r"^\s*\(?\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|GRANT|REVOKE|SET|RESET|"
    r"CALL|DO|TRUNCATE|COPY|BEGIN|COMMIT|ROLLBACK|EXECUTE|PREPARE|DECLARE|LOCK|VALUES|MERGE)\b"
    r"|\bSELECT\b.*\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\b.*\bSET\b|\bDELETE\s+FROM\b"
    r"|\bWHERE\b.*=",
    re.IGNORECASE | re.DOTALL,
)

type QueryModules = Mapping[str, frozenset[str]]


@dataclass(frozen=True)
class Violation:
    path: str
    line: int
    rule: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.rule}"


def module_name(rel: str) -> str:
    name = rel.removesuffix(".py").replace("/", ".")
    return name.removesuffix(".__init__")


def is_query_module(rel: str) -> bool:
    return rel.startswith(QUERY_DIR) and not rel.endswith("/__init__.py")


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


def _store_names(tree: ast.Module) -> dict[str, int]:
    """How many times each name is bound anywhere in the file, by any means."""
    counts: dict[str, int] = {}

    def add(name: str) -> None:
        counts[name] = counts.get(name, 0) + 1

    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store | ast.Del):
            add(node.id)
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            add(node.name)
        elif isinstance(node, ast.arg):
            add(node.arg)
        elif isinstance(node, ast.Global | ast.Nonlocal):
            for name in node.names:
                add(name)
        elif isinstance(node, ast.alias):
            add(node.asname or node.name.split(".")[0])
        elif isinstance(node, ast.ExceptHandler) and node.name:
            add(node.name)
        elif isinstance(node, ast.MatchAs | ast.MatchStar) and node.name:
            add(node.name)
    return counts


def query_constants(source: str, rel: str) -> tuple[frozenset[str], list[Violation]]:
    """The constants of a query module, and every way it breaks rule 1."""
    tree = ast.parse(source, filename=rel)
    found: list[Violation] = []
    names: list[str] = []

    def bad(node: ast.AST, why: str) -> None:
        found.append(Violation(rel, getattr(node, "lineno", 0), f"query module: {why}"))

    for index, stmt in enumerate(tree.body):
        if index == 0 and isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
            continue
        if isinstance(stmt, ast.ImportFrom) and stmt.level == 0:
            allowed = _ALLOWED_QUERY_IMPORTS.get(stmt.module or "")
            if allowed and all(a.name in allowed and a.asname is None for a in stmt.names):
                continue
            bad(stmt, f"import not allowed: {ast.unparse(stmt)}")
            continue
        if not isinstance(stmt, ast.AnnAssign) or not isinstance(stmt.target, ast.Name):
            bad(stmt, f"only annotated constants are allowed: {ast.unparse(stmt)[:60]}")
            continue
        name = stmt.target.id
        annotation = ast.unparse(stmt.annotation)
        if annotation not in ("Final[str]", "Final[LiteralString]"):
            bad(stmt, f"{name} is not Final[str] or Final[LiteralString]")
        if not _CONSTANT_NAME.match(name):
            bad(stmt, f"{name} is not an upper-case constant name")
        value = stmt.value
        literal = isinstance(value, ast.Constant) and isinstance(value.value, str)
        from_file = (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id == "sql_file"
            and len(value.args) == 1
            and not value.keywords
            and isinstance(value.args[0], ast.Constant)
            and isinstance(value.args[0].value, str)
        )
        if not (literal or from_file):
            bad(stmt, f"{name} is not one string literal or sql_file(<literal>)")
        names.append(name)
    counts = _store_names(tree)
    for name in set(names):
        if counts.get(name, 0) != 1:
            bad(tree, f"{name} is bound more than once")
    return frozenset(names), found


class _Checker(ast.NodeVisitor):
    def __init__(self, rel: str, queries: QueryModules, tree: ast.Module) -> None:
        self.rel = rel
        self.queries = queries
        self.found: list[Violation] = []
        self.called: set[int] = {id(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
        self.docstrings = _docstring_ids(tree)
        self.counts = _store_names(tree)
        # Local name -> query module, and local name -> (query module, constant).
        self.module_aliases: dict[str, str] = {}
        self.dotted_modules: set[str] = set()
        self.constant_names: dict[str, tuple[str, str]] = {}
        self.package = module_name(rel).rsplit(".", 1)[0] if "/" in rel else ""
        if rel.endswith("__init__.py"):
            self.package = module_name(rel)

    def _add(self, node: ast.AST, rule: str) -> None:
        self.found.append(Violation(self.rel, getattr(node, "lineno", 0), rule))

    # Imports ------------------------------------------------------------------------------

    def _check_driver(self, node: ast.AST, module: str) -> None:
        if module in COMPOSITION or module.startswith(tuple(f"{c}." for c in COMPOSITION)):
            self._add(node, f"SQL composition module imported: {module}")
        if module.split(".")[0] in DRIVERS and not self.rel.startswith(DATA_ACCESS):
            self._add(node, f"database driver imported outside {DATA_ACCESS}: {module}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_driver(node, alias.name)
            if alias.name in self.queries:
                if alias.asname:
                    self.module_aliases[alias.asname] = alias.name
                else:
                    self.dotted_modules.add(alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        if node.level:
            base = self.package.split(".")
            base = base[: len(base) - (node.level - 1)] if node.level > 1 else base
            module = ".".join([*base, module] if module else base)
        self._check_driver(node, module)
        for alias in node.names:
            self._check_driver(node, f"{module}.{alias.name}")
            local = alias.asname or alias.name
            if f"{module}.{alias.name}" in self.queries:
                self.module_aliases[local] = f"{module}.{alias.name}"
            elif module in self.queries:
                if alias.name not in self.queries[module]:
                    self._add(node, f"not a query constant: {module}.{alias.name}")
                self.constant_names[local] = (module, alias.name)

    # References ---------------------------------------------------------------------------

    def _query_reference(self, node: ast.expr) -> bool:
        if isinstance(node, ast.Name):
            return node.id in self.constant_names and self.counts.get(node.id) == 1
        if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load):
            owner = node.value
            module: str | None = None
            if isinstance(owner, ast.Name) and owner.id in self.module_aliases:
                if self.counts.get(owner.id) == 1:
                    module = self.module_aliases[owner.id]
            elif ast.unparse(owner) in self.dotted_modules:
                module = ast.unparse(owner)
            return module is not None and node.attr in self.queries[module]
        return False

    def _is_query_owner(self, node: ast.expr) -> bool:
        if isinstance(node, ast.Name):
            return node.id in self.module_aliases
        return ast.unparse(node) in self.dotted_modules

    # Visitors -----------------------------------------------------------------------------

    def visit_Constant(self, node: ast.Constant) -> None:
        value = node.value
        if isinstance(value, str | bytes) and id(node) not in self.docstrings:
            text = value if isinstance(value, str) else value.decode("latin-1")
            if _SQL.search(text):
                self._add(node, "SQL text outside a query module")

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        parts = "".join(str(v.value) for v in node.values if isinstance(v, ast.Constant))
        if _SQL.search(parts):
            self._add(node, "SQL text outside a query module (f-string)")
        # The literal parts are not SQL on their own; do not report them twice.
        for value in node.values:
            if isinstance(value, ast.FormattedValue):
                self.visit(value)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in SQL_CALLS and id(node) not in self.called:
            self._add(node, f"SQL call not called at once: {ast.unparse(node)}")
        if isinstance(node.ctx, ast.Store | ast.Del) and self._is_query_owner(node.value):
            self._add(node, f"assignment to a query module: {ast.unparse(node)}")
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in SQL_CALLS and id(node) not in self.called and isinstance(node.ctx, ast.Load):
            self._add(node, f"SQL call not called at once: {node.id}")

    def _rebound(self, name: str, node: ast.AST) -> None:
        if (name in self.module_aliases or name in self.constant_names) and (
            self.counts.get(name, 0) != 1
        ):
            self._add(node, f"query name bound more than once: {name}")

    def visit_Module(self, node: ast.Module) -> None:
        self.generic_visit(node)
        for name in sorted({*self.module_aliases, *self.constant_names}):
            self._rebound(name, node)

    def visit_Call(self, node: ast.Call) -> None:
        name = _call_name(node.func)
        if name in FORBIDDEN_CALLS and isinstance(node.func, ast.Name):
            self._add(node, f"forbidden call: {name}()")
        if name == "getattr":
            self._add(node, "getattr is not allowed in backend source")
        if name in SQL_CALLS:
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
            if not self._query_reference(statement):
                self._add(node, f"SQL argument is not a query constant: {ast.unparse(statement)}")


def check_source(source: str, rel: str, queries: QueryModules) -> list[Violation]:
    tree = ast.parse(source, filename=rel)
    if is_query_module(rel):
        return query_constants(source, rel)[1]
    if rel.startswith(QUERY_DIR):  # the package's __init__.py: a docstring at most
        extra = tree.body[1:] if ast.get_docstring(tree) is not None else tree.body
        return [
            Violation(rel, getattr(s, "lineno", 0), "query package: only a docstring")
            for s in extra
        ]
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
