"""Source guard: nothing in the backend reaches a private part of Starlette (#284, #290, #339).

The routed path is ours (route_path_policy.py): a private Starlette module or name may change in
any release. The scan reads the backend's source (not the tests) as a syntax tree, so comments
are never read and a docstring or message that mentions `starlette._x` is not an import. It is an
allowlist of the forms that may reach Starlette or load a module:

1. `import starlette.<public> [as x]` and `from starlette.<public> import <public> [as x]`: no
   part starts with `_`, though a dunder such as `__version__` is public here;
2. on a name such an import binds, and on any name assigned from one, only a public or dunder
   attribute, no `vars` of it, and no subscript or call argument that is a literal private name;
3. `getattr`, `hasattr`, `setattr` and `delattr` only with a literal public or dunder name, and
   never one of the refused builtins below;
4. no dynamic import: `__import__`, `eval`, `exec` and `compile` are refused everywhere, and so
   is an import of `importlib`, `pkgutil`, `runpy`, `zipimport` or `builtins`, except in the
   files of DYNAMIC_IMPORTS in exactly the form listed there;
5. a string literal passed as a call argument or a key that names a private Starlette module
   (`"starlette._utils"`) is refused anywhere.

What source written to get round these rules can still do is not this guard's to stop; it is
here against mistakes, like sql_source_check.py.
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Final

from tests.guards.query_module_check import Violation
from tests.guards.sql_source_check import source_files

# The only files that may load a module by name, and the one import form each may use.
DYNAMIC_IMPORTS: Final = {
    # The executor loads its fixed list of query modules (ADR 0002, section 9, item 1).
    "player_backend/db/executor/__init__.py": frozenset({("importlib", "import_module")}),
    # The site API's generated answer models, from their files (site/answers.py).
    "player_backend/site/answers.py": frozenset({("importlib.util", None)}),
}
LOADERS: Final = frozenset({"importlib", "pkgutil", "runpy", "zipimport", "builtins"})
REFUSED_BUILTINS: Final = frozenset({"__import__", "eval", "exec", "compile"})
REFLECTION: Final = frozenset({"getattr", "hasattr", "setattr", "delattr"})
_DOTTED: Final = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*")


def is_private(name: str) -> bool:
    """`_x` and `__x` are private; a dunder such as `__init__` is not."""
    dunder = len(name) > 4 and name.startswith("__") and name.endswith("__")
    return name.startswith("_") and not dunder


def _is_starlette(module: str) -> bool:
    return module == "starlette" or module.startswith("starlette.")


def _private_dotted(name: str) -> bool:
    return any(is_private(part) for part in name.split("."))


def names_private_starlette(text: str) -> bool:
    """The string is exactly a dotted name inside Starlette with a private part."""
    return bool(_DOTTED.fullmatch(text)) and _is_starlette(text) and _private_dotted(text)


def _root(node: ast.expr) -> str | None:
    """The name an attribute, subscript or call chain starts from."""
    while isinstance(node, ast.Attribute | ast.Subscript | ast.Call):
        node = node.func if isinstance(node, ast.Call) else node.value
    return node.id if isinstance(node, ast.Name) else None


def _literal(node: ast.expr) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _starlette_bindings(tree: ast.Module) -> set[str]:
    """Every name bound to Starlette: by an import, then by assignment from such a name."""
    bound: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _is_starlette(alias.name):
                    bound.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if _is_starlette(node.module):
                bound.update(a.asname or a.name for a in node.names)
    assignments = list(_assignments(tree))
    grew = True
    while grew:
        grew = False
        for target, value in assignments:
            if target not in bound and _root(value) in bound:
                bound.add(target)
                grew = True
    return bound


def _assignments(tree: ast.Module) -> Iterator[tuple[str, ast.expr]]:
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                for name in ast.walk(target):
                    if isinstance(name, ast.Name):
                        yield name.id, node.value
        elif isinstance(node, ast.AnnAssign | ast.NamedExpr) and node.value is not None:
            if isinstance(node.target, ast.Name):
                yield node.target.id, node.value


class _Checker(ast.NodeVisitor):
    def __init__(self, rel: str, tree: ast.Module) -> None:
        self.rel = rel
        self.bound = _starlette_bindings(tree)
        self.found: list[Violation] = []

    def _add(self, node: ast.AST, rule: str) -> None:
        self.found.append(Violation(self.rel, getattr(node, "lineno", 0), rule))

    def _loader(self, node: ast.AST, form: tuple[str, str | None]) -> None:
        if form[0].split(".")[0] in LOADERS and form not in DYNAMIC_IMPORTS.get(self.rel, ()):
            self._add(node, f"dynamic import: {form[0]} outside DYNAMIC_IMPORTS")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if _is_starlette(alias.name) and _private_dotted(alias.name):
                self._add(node, f"private import: {alias.name}")
            self._loader(node, (alias.name, None))

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        if node.level == 0 and _is_starlette(module):
            for alias in node.names:
                if _private_dotted(f"{module}.{alias.name}"):
                    self._add(node, f"private import: {module}.{alias.name}")
        if node.level == 0:
            for alias in node.names:
                self._loader(node, (module, alias.name))

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr == "__import__":
            self._add(node, "dynamic import: __import__")
        elif is_private(node.attr) and _root(node) in self.bound:
            self._add(node, f"private attribute: .{node.attr}")
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in REFUSED_BUILTINS:
            self._add(node, f"dynamic import: {node.id}")

    def visit_Subscript(self, node: ast.Subscript) -> None:
        self._key(node, node.slice, _root(node.value))
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in REFLECTION:
            name = _literal(node.args[1]) if len(node.args) > 1 else None
            if name is None or is_private(name) or name in REFUSED_BUILTINS:
                self._add(node, f"reflection: {node.func.id} without a literal public name")
        if isinstance(node.func, ast.Name) and node.func.id == "vars":
            if any(_root(arg) in self.bound for arg in node.args):
                self._add(node, "reflection: vars of a Starlette name")
        root = _root(node.func)
        for arg in [*node.args, *(k.value for k in node.keywords)]:
            self._key(node, arg, root)
        self.generic_visit(node)

    def _key(self, node: ast.AST, key: ast.expr, root: str | None) -> None:
        text = _literal(key)
        if text is None:
            return
        if names_private_starlette(text):
            self._add(node, f"private module named: {text}")
        elif root in self.bound and is_private(text.rsplit(".", 1)[-1]):
            self._add(node, f"private name looked up: {text}")


def check_source(source: str, rel: str) -> list[Violation]:
    tree = ast.parse(source, filename=rel)
    checker = _Checker(rel, tree)
    checker.visit(tree)
    return checker.found


def check_tree(src: Path) -> list[Violation]:
    files = source_files(src)
    return [v for rel in sorted(files) for v in check_source(files[rel], rel)]
