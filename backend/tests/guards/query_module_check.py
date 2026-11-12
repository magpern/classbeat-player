"""Rule 1 of the SQL source guard: what a query module may contain (see sql_source_check.py)."""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass

QUERY_PACKAGE = "player_backend.db.queries"
QUERY_DIR = "player_backend/db/queries/"
_ALLOWED_IMPORTS = {
    "typing": frozenset({"Final", "LiteralString"}),
    "player_backend.db.sqlfile": frozenset({"sql_file"}),
}
_CONSTANT_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")


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


def store_names(tree: ast.Module) -> dict[str, int]:
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


def _from_file(value: ast.expr | None) -> bool:
    return (
        isinstance(value, ast.Call)
        and isinstance(value.func, ast.Name)
        and value.func.id == "sql_file"
        and len(value.args) == 1
        and not value.keywords
        and isinstance(value.args[0], ast.Constant)
        and isinstance(value.args[0].value, str)
    )


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
            allowed = _ALLOWED_IMPORTS.get(stmt.module or "")
            if allowed and all(a.name in allowed and a.asname is None for a in stmt.names):
                continue
            bad(stmt, f"import not allowed: {ast.unparse(stmt)}")
            continue
        if not isinstance(stmt, ast.AnnAssign) or not isinstance(stmt.target, ast.Name):
            bad(stmt, f"only annotated constants are allowed: {ast.unparse(stmt)[:60]}")
            continue
        name = stmt.target.id
        if ast.unparse(stmt.annotation) not in ("Final[str]", "Final[LiteralString]"):
            bad(stmt, f"{name} is not Final[str] or Final[LiteralString]")
        if not _CONSTANT_NAME.match(name):
            bad(stmt, f"{name} is not an upper-case constant name")
        value = stmt.value
        literal = isinstance(value, ast.Constant) and isinstance(value.value, str)
        if not (literal or _from_file(value)):
            bad(stmt, f"{name} is not one string literal or sql_file(<literal>)")
        names.append(name)
    counts = store_names(tree)
    for name in set(names):
        if counts.get(name, 0) != 1:
            bad(tree, f"{name} is bound more than once")
    return frozenset(names), found


def package_init_violations(tree: ast.Module, rel: str) -> list[Violation]:
    """The query package's __init__.py holds a docstring at most."""
    extra = tree.body[1:] if ast.get_docstring(tree) is not None else tree.body
    return [
        Violation(rel, getattr(s, "lineno", 0), "query package: only a docstring") for s in extra
    ]
