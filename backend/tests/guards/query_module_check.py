"""Source guard, rule 5: where a `Query` is made (see sql_source_check.py).

A query module holds a docstring, `from typing import Final`, `from player_backend.db.executor
import Query`, and constants `NAME: Final[Query] = Query(<one string literal>)` or
`Query.from_file(<one string literal>)`, each bound once. Nothing else.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass

EXECUTOR = "player_backend.db.executor"
QUERY_PACKAGE = "player_backend.db.queries"
QUERY_DIR = "player_backend/db/queries/"
_ALLOWED_IMPORTS = {"typing": frozenset({"Final"}), EXECUTOR: frozenset({"Query"})}
_CONSTANT_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
_MAKERS = ("Query", "Query.from_file")


@dataclass(frozen=True)
class Violation:
    path: str
    line: int
    rule: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.rule}"


def module_name(rel: str) -> str:
    return rel.removesuffix(".py").replace("/", ".").removesuffix(".__init__")


def is_query_module(rel: str) -> bool:
    return rel.startswith(QUERY_DIR) and not rel.endswith("/__init__.py")


def _made_from_a_literal(value: ast.expr | None) -> bool:
    return (
        isinstance(value, ast.Call)
        and ast.unparse(value.func) in _MAKERS
        and len(value.args) == 1
        and not value.keywords
        and isinstance(value.args[0], ast.Constant)
        and isinstance(value.args[0].value, str)
    )


def query_constants(source: str, rel: str) -> tuple[frozenset[str], list[Violation]]:
    """The constants of a query module, and every way it breaks the rule."""
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
            if not (allowed and all(a.name in allowed and a.asname is None for a in stmt.names)):
                bad(stmt, f"import not allowed: {ast.unparse(stmt)}")
            continue
        if not isinstance(stmt, ast.AnnAssign) or not isinstance(stmt.target, ast.Name):
            bad(stmt, f"only Query constants are allowed: {ast.unparse(stmt)[:60]}")
            continue
        name = stmt.target.id
        if ast.unparse(stmt.annotation) != "Final[Query]":
            bad(stmt, f"{name} is not annotated Final[Query]")
        if not _CONSTANT_NAME.match(name):
            bad(stmt, f"{name} is not an upper-case constant name")
        if not _made_from_a_literal(stmt.value):
            bad(stmt, f"{name} is not Query(<literal>) or Query.from_file(<literal>)")
        if name in names:
            bad(stmt, f"{name} is bound more than once")
        names.append(name)
    return frozenset(names), found


def package_init_violations(tree: ast.Module, rel: str) -> list[Violation]:
    """The query package's __init__.py: a docstring and the import of the executor."""
    body = tree.body[1:] if ast.get_docstring(tree) is not None else tree.body
    return [
        Violation(rel, stmt.lineno, "query package: only a docstring and the executor's import")
        for stmt in body
        if ast.unparse(stmt) != f"import {EXECUTOR}"
    ]
