"""Source guard for ADR 0002, section 5, "Where the session cookie is accepted".

A cookie is read in one module (`COOKIE_MODULE`), by its reader functions, and a reader is used
only as a FastAPI dependency, so that every route that reads a cookie shows it in its
dependencies (test_guard_cookie_routes.py compares those routes with the written list).

It reads the backend's source and fails, outside the cookie module, on:

1. a `.cookies` attribute, or a `Cookie` name or import (FastAPI's parameter, `http.cookies`);
2. a string that is the `Cookie` header's name or holds a `__Host-` cookie name;
3. a reader used other than as the dependency of a `Depends(...)` call.

Like the SQL source guard, it is for mistakes, not for code written to get round it.
"""

from __future__ import annotations

import ast
from pathlib import Path

COOKIE_MODULE = "player_backend/site/cookies.py"
READERS = frozenset({"session_cookie_token", "login_cookie_token"})
_COOKIE_NAMES = frozenset({"Cookie", "SimpleCookie", "BaseCookie", "cookies"})


class _Checker(ast.NodeVisitor):
    def __init__(self) -> None:
        self.found: list[str] = []
        self.as_dependency: set[int] = set()

    def _add(self, node: ast.AST, rule: str) -> None:
        self.found.append(f"{getattr(node, 'lineno', 0)}: {rule}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name.split(".")[-1] in _COOKIE_NAMES:
                self._add(node, f"1: cookie import: {alias.name}")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        for alias in node.names:
            if alias.name in _COOKIE_NAMES or module.split(".")[-1] == "cookies":
                if not (module.endswith("site.cookies") and alias.name not in _COOKIE_NAMES):
                    self._add(node, f"1: cookie import: {module}.{alias.name}")

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in _COOKIE_NAMES:
            self._add(node, f"1: cookie attribute: {node.attr}")
        if node.attr in READERS and id(node) not in self.as_dependency:
            self._add(node, f"3: cookie reader not used as a dependency: {node.attr}")
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in _COOKIE_NAMES:
            self._add(node, f"1: cookie name: {node.id}")
        if node.id in READERS and id(node) not in self.as_dependency:
            self._add(node, f"3: cookie reader not used as a dependency: {node.id}")

    def visit_Call(self, node: ast.Call) -> None:
        if ast.unparse(node.func) == "Depends" and node.args:
            self.as_dependency.add(id(node.args[0]))
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant) -> None:
        value = node.value
        text = value.decode("latin-1") if isinstance(value, bytes) else value
        if isinstance(text, str):
            lowered = text.strip().lower()
            if lowered == "cookie" or "__host-" in lowered:
                self._add(node, "2: string naming a cookie or the Cookie header")


def check_source(source: str, rel: str) -> list[str]:
    if rel == COOKIE_MODULE:
        return []
    checker = _Checker()
    checker.visit(ast.parse(source, filename=rel))
    return [f"{rel}:{found}" for found in checker.found]


def check_tree(src: Path) -> list[str]:
    found: list[str] = []
    for path in sorted(src.rglob("*.py")):
        rel = path.relative_to(src).as_posix()
        found.extend(check_source(path.read_text(encoding="utf-8"), rel))
    return found
