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
   files of DYNAMIC_IMPORTS in exactly the form listed there, and there each name it binds is
   used only as a call of a function listed with it;
5. the text rules of starlette_name_check.py: no string constant anywhere, nor a constant part
   of an f-string or a `+`, that spells a private Starlette name or the start of one, and the old
   `starlette . _x` scan over the code's tokens (comments, strings and dunders left out).

What source written to get round these rules can still do is not this guard's to stop; it is
here against mistakes, like sql_source_check.py.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from tests.guards.query_module_check import Violation
from tests.guards.sql_source_check import source_files
from tests.guards.starlette_name_check import (
    backstop_violations,
    is_private,
    string_violations,
)

Form = tuple[str, str | None]


@dataclass(frozen=True)
class Loader:
    """The import forms a file may load modules with, and the calls it may make with them."""

    forms: frozenset[Form]
    calls: frozenset[str]


# The only files that may load a module by name: each one's import form and its calls.
DYNAMIC_IMPORTS: Final = {
    # The executor loads its fixed list of query modules (ADR 0002, section 9, item 1).
    "player_backend/db/executor/__init__.py": Loader(
        frozenset({("importlib", "import_module")}), frozenset({"importlib.import_module"})
    ),
    # The site API's generated answer models, from their files (site/answers.py).
    "player_backend/site/answers.py": Loader(
        frozenset({("importlib.util", None)}),
        frozenset({"importlib.util.spec_from_file_location", "importlib.util.module_from_spec"}),
    ),
}
_NO_LOADER: Final = Loader(frozenset(), frozenset())
LOADERS: Final = frozenset({"importlib", "pkgutil", "runpy", "zipimport", "builtins"})
REFUSED_BUILTINS: Final = frozenset({"__import__", "eval", "exec", "compile"})
REFLECTION: Final = frozenset({"getattr", "hasattr", "setattr", "delattr"})


def _is_starlette(module: str) -> bool:
    return module == "starlette" or module.startswith("starlette.")


def _private_dotted(name: str) -> bool:
    return any(is_private(part) for part in name.split("."))


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


def _loader_names(tree: ast.Module) -> dict[str, str]:
    """Each name a loader import binds, mapped to the dotted name it stands for."""
    names: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                top = a.name.split(".")[0]
                if top in LOADERS:
                    names[a.asname or top] = a.name if a.asname else top
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module.split(".")[0] in LOADERS:
                names.update({a.asname or a.name: f"{node.module}.{a.name}" for a in node.names})
    return names


def _loader_call_violations(tree: ast.Module, loader: Loader) -> list[tuple[int, str]]:
    """A name a loader import binds, used other than as a call of a listed function."""
    names = _loader_names(tree)
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Name) and node.id in names):
            continue
        top: ast.expr = node
        dotted = names[node.id]
        while isinstance(up := parents.get(top), ast.Attribute) and up.value is top:
            top, dotted = up, f"{dotted}.{up.attr}"
        call = parents.get(top)
        if not (isinstance(call, ast.Call) and call.func is top and dotted in loader.calls):
            found.append((node.lineno, f"dynamic import: {dotted} is not a listed call"))
    return found


class _Checker(ast.NodeVisitor):
    def __init__(self, rel: str, tree: ast.Module) -> None:
        self.rel = rel
        self.bound = _starlette_bindings(tree)
        self.loader = DYNAMIC_IMPORTS.get(rel, _NO_LOADER)
        self.found: list[Violation] = []

    def _add(self, node: ast.AST, rule: str) -> None:
        self.found.append(Violation(self.rel, getattr(node, "lineno", 0), rule))

    def _loader(self, node: ast.AST, form: Form) -> None:
        if form[0].split(".")[0] in LOADERS and form not in self.loader.forms:
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
        if root in self.bound and is_private(text.rsplit(".", 1)[-1]):
            self._add(node, f"private name looked up: {text}")


def check_source(source: str, rel: str) -> list[Violation]:
    tree = ast.parse(source, filename=rel)
    checker = _Checker(rel, tree)
    checker.visit(tree)
    text_rules = [
        *string_violations(tree),
        *backstop_violations(source),
        *_loader_call_violations(tree, checker.loader),
    ]
    return checker.found + [Violation(rel, line, rule) for line, rule in text_rules]


def check_tree(src: Path) -> list[Violation]:
    files = source_files(src)
    return [v for rel in sorted(files) for v in check_source(files[rel], rel)]
