"""Static check of the backend's source (ADR 0002, section 9, item 1).

Fails on:
- SQL text built by an f-string, `str.format`, `%` or `+`;
- any import of a database driver, or of psycopg's SQL composition, outside the data-access
  package `player_backend/db/`;
- an `execute`-like call whose statement is not a constant: a string literal, or a module-level
  name bound once to one. The single exception is the migration runner executing a shipped file.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import Path

DATA_ACCESS = "player_backend/db/"
DRIVERS = ("psycopg", "psycopg2", "psycopg_pool", "asyncpg", "sqlalchemy", "pg8000", "databases")
COMPOSITION = ("psycopg.sql", "psycopg2.sql")
EXECUTE_METHODS = frozenset({"execute", "executemany", "copy", "stream", "cursor_execute"})
# (file relative to src/, the statement argument exactly as written).
TRUSTED_STATEMENTS = frozenset({("player_backend/db/migrate.py", "migration.body")})

_SQL = re.compile(
    r"^\s*\(?\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|GRANT|REVOKE|SET|RESET|"
    r"CALL|DO|TRUNCATE|COPY|BEGIN|COMMIT|ROLLBACK|EXECUTE|PREPARE|DECLARE|LOCK|VALUES|MERGE)\b"
    r"|\bSELECT\b.*\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\b.*\bSET\b|\bDELETE\s+FROM\b"
    r"|\bWHERE\b.*=",
    re.IGNORECASE | re.DOTALL,
)


@dataclass(frozen=True)
class Violation:
    path: str
    line: int
    rule: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.rule}"


def _looks_like_sql(node: ast.expr) -> bool:
    if isinstance(node, ast.Constant) and isinstance(node.value, str | bytes):
        text = node.value if isinstance(node.value, str) else node.value.decode("latin-1")
        return bool(_SQL.search(text))
    if isinstance(node, ast.JoinedStr):
        parts = [v.value for v in node.values if isinstance(v, ast.Constant)]
        return bool(_SQL.search("".join(str(p) for p in parts)))
    if isinstance(node, ast.BinOp):
        return _looks_like_sql(node.left) or _looks_like_sql(node.right)
    return False


def _joins_sql(node: ast.expr) -> bool:
    if isinstance(node, ast.List | ast.Tuple | ast.Set):
        return any(_looks_like_sql(e) for e in node.elts)
    return _looks_like_sql(node)


class _Checker(ast.NodeVisitor):
    def __init__(self, rel: str) -> None:
        self.rel = rel
        self.found: list[Violation] = []
        self.constants: set[str] = set()

    def _add(self, node: ast.AST, rule: str) -> None:
        self.found.append(Violation(self.rel, getattr(node, "lineno", 0), rule))

    def collect_constants(self, tree: ast.Module) -> None:
        counts: dict[str, int] = {}
        for stmt in tree.body:
            targets: list[ast.expr] = []
            value: ast.expr | None = None
            if isinstance(stmt, ast.Assign):
                targets, value = stmt.targets, stmt.value
            elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
                targets, value = [stmt.target], stmt.value
            for target in targets:
                if isinstance(target, ast.Name):
                    counts[target.id] = counts.get(target.id, 0) + 1
                    is_literal = isinstance(value, ast.Constant) and isinstance(
                        value.value, str | bytes
                    )
                    if is_literal:
                        self.constants.add(target.id)
        # A name assigned more than once at module level is not a constant.
        self.constants = {n for n in self.constants if counts[n] == 1}

    def _check_import(self, node: ast.AST, module: str) -> None:
        if module in COMPOSITION or module.startswith(tuple(f"{c}." for c in COMPOSITION)):
            self._add(node, f"SQL composition module imported: {module}")
        root = module.split(".")[0]
        if root in DRIVERS and not self.rel.startswith(DATA_ACCESS):
            self._add(node, f"database driver imported outside {DATA_ACCESS}: {module}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_import(node, alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        self._check_import(node, module)
        for alias in node.names:
            self._check_import(node, f"{module}.{alias.name}")

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        if any(isinstance(v, ast.FormattedValue) for v in node.values) and _looks_like_sql(node):
            self._add(node, "SQL built with an f-string")
        self.generic_visit(node)

    def visit_BinOp(self, node: ast.BinOp) -> None:
        if isinstance(node.op, ast.Mod | ast.Add) and _looks_like_sql(node):
            self._add(node, "SQL built with % or +")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Attribute):
            if func.attr in {"format", "format_map"} and _looks_like_sql(func.value):
                self._add(node, "SQL built with str.format")
            if func.attr == "join" and any(_joins_sql(a) for a in node.args):
                self._add(node, "SQL built with str.join")
            if func.attr in EXECUTE_METHODS and node.args:
                self._check_statement(node, node.args[0])
        self.generic_visit(node)

    def _check_statement(self, node: ast.Call, arg: ast.expr) -> None:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str | bytes):
            return
        if isinstance(arg, ast.Name) and arg.id in self.constants:
            return
        if (self.rel, ast.unparse(arg)) in TRUSTED_STATEMENTS:
            return
        self._add(node, f"statement is not a constant: {ast.unparse(arg)}")


def check_source(source: str, rel: str) -> list[Violation]:
    tree = ast.parse(source, filename=rel)
    checker = _Checker(rel)
    checker.collect_constants(tree)
    checker.visit(tree)
    return checker.found


def check_tree(src: Path) -> list[Violation]:
    found: list[Violation] = []
    for path in sorted(src.rglob("*.py")):
        rel = path.relative_to(src).as_posix()
        found.extend(check_source(path.read_text(encoding="utf-8"), rel))
    return found
